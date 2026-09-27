# Mise à jour de la Lucibox actuelle — réalignement sur le guide

Ce guide ne contient que les **écarts** entre le Pi en service (`patch@patchbox.local`) et `RPI_RT_SETUP.md`.
État relevé le **27/09/2026** : Pi 3B, Raspbian 11 / Patchbox, noyau `5.15.36-rt41-v7+`, Pisound.

Toutes les commandes se tapent à la main en SSH. **Un seul redémarrage à la fin (étape 9).**
Le son est coupé quelques secondes à l'étape 6 (redémarrage de JACK et Pd).

---

## Déjà conforme — rien à faire

| Point | Relevé |
|---|---|
| Noyau PREEMPT_RT | `/sys/kernel/realtime` = 1 |
| Governor CPU | `performance` ×4, 1,2 GHz |
| Alimentation / température | `throttled=0x0`, 54 °C |
| Groupes `patch` | audio, jack, dialout ✓ |
| Limites RT de session | `limits.d/audio.conf` : rtprio 95, memlock unlimited ✓ |
| Démarrage | console (`multi-user.target`) ✓ |
| `/` en `noatime` | ✓ |
| Sudo sans mot de passe | ✓ |
| Arduino | `/dev/ttyACM0` ✓ |
| `git`, `node`, `npm`, `raspi-config` | installés ✓ |

---

## Étape 1 — Sauvegardes

```bash
mkdir -p ~/rt-backup
# ⚠ pousser d'abord sur GitHub la nouvelle version de script/lucibox-pd.service (utilisée à l'étape 6)
sudo cp -a /boot/config.txt /etc/jackdrc /etc/systemd/system/lucibox-pd.service /etc/rc.local ~/rt-backup/
ls ~/rt-backup
```

---

## Étape 2 — `/boot/config.txt`

Relevé : `dtparam=audio=on`, `dtoverlay=vc4-kms-v3d`, `hdmi_force_hotplug=1`, pas de `gpu_mem` ni de `force_turbo`.

```bash
sudo sed -i 's/^dtparam=audio=on/dtparam=audio=off/' /boot/config.txt
sudo sed -i 's/^dtoverlay=vc4-kms-v3d/#&/; s/^hdmi_force_hotplug=1/#&/' /boot/config.txt
echo 'gpu_mem=16'    | sudo tee -a /boot/config.txt
echo 'force_turbo=1' | sudo tee -a /boot/config.txt

# OPTIONNEL — Bluetooth coupé (⚠ l'appli mobile Pisound ne marchera plus)
echo 'dtoverlay=disable-bt' | sudo tee -a /boot/config.txt
```

Vérifier (effet après le redémarrage de l'étape 9) :
```bash
grep -vE '^#|^$' /boot/config.txt
```

---

## Étape 3 — Services

Relevé : actifs `cups`, `cups-browsed`, `colord`, `vncserver-x11-serviced`, `epmd`, `triggerhappy`, `rsyslog`, `bluetooth`, `hciuart`, `pisound-ctl` ; activés mais au repos `lightdm`, `udisks2`, `dphys-swapfile`, timers apt et man-db.

```bash
sudo systemctl disable --now \
  cups cups-browsed cups.path cups.socket colord \
  vncserver-x11-serviced lightdm \
  triggerhappy triggerhappy.socket udisks2 \
  epmd epmd.socket \
  apt-daily.timer apt-daily-upgrade.timer man-db.timer

# OPTIONNEL — seulement si Bluetooth coupé à l'étape 2
sudo systemctl disable --now bluetooth hciuart pisound-ctl
```

Vérifier :
```bash
systemctl list-units --type=service --state=running --no-pager
```

---

## Étape 4 — Logs en RAM

Relevé : `/var/log/journal` existe (662 Mo de journal persistant sur la SD) et `rsyslog` écrit aussi dans `/var/log/*.log` (`daemon.log` : 6,7 Mo pour la seule journée du 27/09, surtout des `print: potar3`).

```bash
sudo mkdir -p /etc/systemd/journald.conf.d
sudo tee /etc/systemd/journald.conf.d/volatile.conf <<'EOF'
[Journal]
Storage=volatile
RuntimeMaxUse=30M
ForwardToSyslog=no
EOF

sudo systemctl disable --now rsyslog
sudo systemctl restart systemd-journald
sudo rm -rf /var/log/journal

# anciens fichiers rsyslog, désormais inutiles
sudo rm -f /var/log/syslog* /var/log/messages* /var/log/debug* \
  /var/log/{daemon,user,kern,auth}.log*
```

Vérifier :
```bash
journalctl --disk-usage               # quelques Mo
ls /run/log/journal                   # existe (RAM)
du -sh /var/log                       # quelques Mo
```

---

## Étape 5 — Swap

Relevé : `/var/swap` de 100 Mo, swappiness 60.

```bash
sudo dphys-swapfile swapoff
sudo systemctl disable --now dphys-swapfile
sudo rm -f /var/swap
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/90-swappiness.conf
sudo sysctl -p /etc/sysctl.d/90-swappiness.conf
```

Vérifier :
```bash
free -m                               # Swap: 0 0 0
```

---

## Étape 6 — JACK, IRQ audio et service Pd

Relevé :
- `/etc/jackdrc` : `jackd -t 2000 -R -P 95 … -X seq -s -S` → priorité trop haute (au-dessus des IRQ audio), softmode qui masque les xruns, 16 bits forcés.
- IRQ audio (DMA 82/83, SPI 111) à FIFO 50, au même niveau que l'USB (~2 700 IRQ/s avec l'Arduino).
- `lucibox-pd.service` : `CPUSchedulingPriority=70` (écrasé par Pd, le thread principal finit à 6) et pas de `LimitRTPRIO` (pd tourne avec une limite RT à 0, il n'obtient ses priorités que grâce à `CAP_SYS_NICE`).

**JACK** — priorité 80, sans `-s` ni `-S` :
```bash
sudo sed -i 's|-R -P 95 |-R -P 80 |; s| -s -S *$||' /etc/jackdrc
tail -1 /etc/jackdrc
# attendu : exec /usr/bin/jackd -t 2000 -R -P 80 -d alsa -d hw:pisound -r 48000 -p 128 -n 2 -X seq
```

**IRQ audio** à 90 :
```bash
sudo tee /usr/local/bin/audio-irq-prio.sh <<'EOF'
#!/bin/sh
# IRQ Pisound au-dessus de jackd (-P 80) : 82/83 = DMA I2S, 111 = SPI MIDI.
n=0
for irq in 82 83 111; do
  for tid in $(pgrep "^irq/${irq}-"); do chrt -f -p 90 "$tid" && n=$((n+1)); done
done
[ "$n" -ge 3 ] || { echo "audio-irq-prio: $n IRQ trouvees sur 3" >&2; exit 1; }
EOF
sudo chmod +x /usr/local/bin/audio-irq-prio.sh

sudo tee /etc/systemd/system/audio-irq-prio.service <<'EOF'
[Unit]
Description=Priorite RT des IRQ audio Pisound
After=sound.target jack.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/bin/audio-irq-prio.sh

[Install]
WantedBy=multi-user.target
EOF
```

**Service Pd** — la version corrigée (sans `CPUScheduling*`, avec `LimitRTPRIO=95`) est dans le repo :
```bash
git -C ~/lucibox pull
sudo cp ~/lucibox/script/lucibox-pd.service /etc/systemd/system/
grep -E 'Limit|CPUSched|Ambient' /etc/systemd/system/lucibox-pd.service
# attendu : LimitRTPRIO=95, LimitMEMLOCK=infinity, AmbientCapabilities=CAP_SYS_NICE — plus de CPUSched
```

**Appliquer :**
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now audio-irq-prio
sudo systemctl restart jack
sudo systemctl restart lucibox-pd
```

Vérifier :
```bash
systemctl is-active jack lucibox-pd lucibox-node audio-irq-prio
ps -eLo tid,cls,rtprio,comm | grep -E 'jackd|pd$|irq/(82|83|111)-' | grep FF
#   irq/82, irq/83, irq/111 → 90
#   jackd                   → 80
#   pd                      → 75 (thread DSP) + un thread bas (principal)
grep -i 'realtime pri' /proc/$(pgrep -o -x pd)/limits   # 95
```

---

## Étape 7 — Wi-Fi

Relevé : `iw` absent, économie d'énergie Wi-Fi non maîtrisée.

```bash
sudo apt install -y iw
sudo iw wlan0 set power_save off
sudo sed -i 's|^exit 0|/usr/sbin/iw wlan0 set power_save off\nexit 0|' /etc/rc.local
```

Vérifier :
```bash
iw wlan0 get power_save               # Power save: off
tail -3 /etc/rc.local
```

---

## Étape 8 — Code Lucibox

Le `git pull` a déjà été fait à l'étape 6 (le Pi était sur `97db473`).

Côté patchs (sur le Mac, puis `git pull` sur le Pi) :
- `potar3` imprime environ 7 lignes/s et oscille entre 977 et 988 au repos : retirer le `[print]` (ou le mettre derrière un `[spigot]`), ajouter un `[change]` et une zone morte côté Arduino.

---

## Étape 9 — Redémarrage et validation

```bash
sudo reboot
```

Après redémarrage :
```bash
uname -v                                    # PREEMPT_RT
cat /proc/asound/cards                      # pisound seul
vcgencmd get_mem gpu                        # gpu=16M
vcgencmd get_throttled                      # 0x0
free -m                                     # Swap 0
journalctl --disk-usage                     # en RAM, quelques Mo
systemctl is-active jack lucibox-pd lucibox-node audio-irq-prio
ps -eLo tid,cls,rtprio,comm | grep -E 'jackd|pd$|irq/(82|83|111)-' | grep FF
```

Test de latence, patch en jeu :
```bash
sudo apt install -y rt-tests
sudo cyclictest -m -Sp90 -i200 -h400 -q -D 5m      # max < ~100 µs
```

Puis 30 min de jeu réel :
```bash
journalctl -u jack -b | grep -ic xrun             # 0
```

> Le compteur de xruns peut monter par rapport à avant : sans `-s`, JACK signale enfin les xruns qu'il masquait. Si c'est le cas, passer à `-p 256` dans `/etc/jackdrc` et comparer.

---

## Étape 10 — Carte SD en lecture seule (quand tout est validé)

```bash
sudo raspi-config nonint enable_overlayfs
sudo raspi-config nonint enable_bootro
sudo reboot
mount | grep ' / '                          # overlay on / type overlay
```

Pour toute modification ultérieure (`git pull`, réglage) :
```bash
sudo raspi-config nonint disable_overlayfs && sudo raspi-config nonint disable_bootro && sudo reboot
# … modifications …
sudo raspi-config nonint enable_overlayfs && sudo raspi-config nonint enable_bootro && sudo reboot
```

---

## Retour arrière

```bash
sudo cp ~/rt-backup/config.txt /boot/config.txt
sudo cp ~/rt-backup/jackdrc /etc/jackdrc
sudo cp ~/rt-backup/lucibox-pd.service /etc/systemd/system/
sudo cp ~/rt-backup/rc.local /etc/rc.local
sudo rm /etc/systemd/journald.conf.d/volatile.conf
sudo systemctl disable audio-irq-prio
sudo systemctl enable rsyslog dphys-swapfile      # + tout service à réactiver
sudo systemctl daemon-reload
sudo reboot
```
