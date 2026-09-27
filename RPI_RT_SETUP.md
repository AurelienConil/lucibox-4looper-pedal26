# Raspberry Pi temps réel pour Pure Data — installation depuis zéro

Cible : **Raspberry Pi 3B + Pisound**, **Patchbox OS (Bullseye)** fraîchement flashé, JACK + Pd + Node lancés par systemd.
Toutes les commandes se tapent **à la main**, dans l'ordre, en SSH (`ssh patch@patchbox.local`).
Chaque étape se termine par une vérification : ne pas passer à la suivante si elle échoue.

> Guide « monde idéal » : on part d'une carte fraîchement flashée.
> Pour réaligner un Pi déjà en service, voir `RPI_RT_UPDATE_LUCIBOX.md`.
> Les numéros d'IRQ (étape 8) dépendent du noyau et du modèle de Pi : toujours les revérifier.

---

## Étape 0 — Premier démarrage

```bash
ssh patch@patchbox.local          # mot de passe par défaut : blokaslabs
sudo patchbox                     # assistant Patchbox
```

Dans l'assistant :
- changer le mot de passe ;
- **Soundcard** → `pisound` ;
- **Kernel** → noyau **RT** ;
- **Boot** → console (pas de bureau) ;
- **Module** → aucun (ce sont nos propres services qui lancent Pd).

```bash
sudo reboot
```

Vérifier :
```bash
uname -v                          # contient PREEMPT_RT
cat /sys/kernel/realtime          # 1
cat /proc/asound/cards            # pisound présent
```

> ⚠ Après un `apt upgrade`, revérifier `uname -v` : une mise à jour du paquet noyau peut remplacer le noyau RT.

---

## Étape 1 — Matériel inutile coupé dans `/boot/config.txt`

```bash
sudo cp /boot/config.txt /boot/config.txt.orig

# sortie audio interne (jack 3,5 mm / HDMI) : seul le Pisound sert
sudo sed -i 's/^dtparam=audio=on/dtparam=audio=off/' /boot/config.txt

# headless : pas de pilote graphique, pas d'HDMI forcé
sudo sed -i 's/^dtoverlay=vc4-kms-v3d/#&/; s/^hdmi_force_hotplug=1/#&/' /boot/config.txt

# RAM GPU minimale + fréquence CPU fixe (sans surtension : garantie conservée)
echo 'gpu_mem=16'    | sudo tee -a /boot/config.txt
echo 'force_turbo=1' | sudo tee -a /boot/config.txt

# OPTIONNEL — Bluetooth coupé (⚠ l'appli mobile Pisound ne marchera plus)
echo 'dtoverlay=disable-bt' | sudo tee -a /boot/config.txt

sudo reboot
```

Vérifier :
```bash
cat /proc/asound/cards                # plus de "bcm2835 Headphones" ni "vc4hdmi"
vcgencmd get_mem gpu                  # gpu=16M
vcgencmd measure_clock arm            # ~1200000000, stable
vcgencmd get_throttled                # throttled=0x0  (sinon : alim / refroidissement)
vcgencmd measure_temp                 # < 70 °C
cat /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor   # performance ×4 (service Patchbox)
```

---

## Étape 2 — Services inutiles désactivés

```bash
sudo systemctl disable --now \
  cups cups-browsed cups.path cups.socket colord \
  vncserver-x11-serviced lightdm \
  triggerhappy triggerhappy.socket udisks2 \
  epmd epmd.socket \
  apt-daily.timer apt-daily-upgrade.timer man-db.timer

# OPTIONNEL — si Bluetooth coupé à l'étape 1
sudo systemctl disable --now bluetooth hciuart pisound-ctl
```

À **garder** : `ssh`, `avahi-daemon` (nom `patchbox.local`), `dhcpcd`, `wpa_supplicant`, `pisound-btn`, `amidiauto`, `systemd-timesyncd`, `cpu_performance_scaling_governor`.

Vérifier :
```bash
systemctl list-units --type=service --state=running --no-pager
```

---

## Étape 3 — Logs en RAM, plus aucune écriture de log sur la carte SD

Par défaut journald garde les logs en RAM **sauf si `/var/log/journal` existe**, et Patchbox le crée. En plus, `rsyslog` recopie tout dans `/var/log/*.log`.

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
sudo rm -rf /var/log/journal          # anciens logs persistants (plusieurs centaines de Mo)
```

Vérifier :
```bash
journalctl --disk-usage               # quelques Mo, dans /run (RAM)
ls /run/log/journal                   # existe
ls /var/log/journal                   # n'existe plus
```

> Les logs sont perdus à chaque redémarrage : c'est voulu.

---

## Étape 4 — Swap coupé

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

## Étape 5 — Utilisateur, groupes, limites RT

Normalement déjà fait par Patchbox. À vérifier seulement :

```bash
groups patch                          # doit contenir audio, jack, dialout (Arduino)
grep -hE '^[^#]*(rtprio|memlock)' /etc/security/limits.d/*.conf
#   @audio - rtprio 95
#   @audio - memlock unlimited
```

Si un groupe manque :
```bash
sudo usermod -aG audio,jack,dialout patch
```

> Ces limites ne valent que pour les sessions SSH / login. **Les services systemd ne les voient pas** : elles sont redéclarées dans les units (étapes 6 et 9).

---

## Étape 6 — JACK

Ordre des priorités visé (du plus prioritaire au moins prioritaire) :

```
IRQ audio Pisound (DMA I2S + SPI)   FIFO 90   ← étape 8
jackd                               FIFO 80
thread DSP de Pd (client JACK)      FIFO 75   (= priorité JACK − 5, automatique)
autres IRQ (USB, Wi-Fi, SD…)        FIFO 50   (défaut du noyau RT)
thread principal de Pd              FIFO bas
node, sshd, le reste                normal
```

```bash
sudo cp /etc/jackdrc /etc/jackdrc.orig
sudo tee /etc/jackdrc <<'EOF'
#!/bin/sh
exec /usr/bin/jackd -t 2000 -R -P 80 -d alsa -d hw:pisound -r 48000 -p 128 -n 2 -X seq
EOF
sudo systemctl restart jack
```

- `-p 128 -n 2` à 48 kHz = 2,7 ms par période, ~5,3 ms de latence.
- **Pas de `-s`** (softmode) : il masque les xruns.
- **Pas de `-S`** (16 bits) : le Pisound fait du 24 bits.
- `-X seq` : seulement si Pd doit voir les ports MIDI ALSA via JACK.

Vérifier :
```bash
systemctl is-active jack
ps -eLo tid,cls,rtprio,comm | grep jackd | grep FF      # un thread FF 80
```

---

## Étape 7 — Wi-Fi sans économie d'énergie

```bash
sudo apt install -y iw                # absent de Patchbox par défaut
sudo iw wlan0 set power_save off
sudo sed -i 's|^exit 0|/usr/sbin/iw wlan0 set power_save off\nexit 0|' /etc/rc.local
```

Vérifier :
```bash
iw wlan0 get power_save               # Power save: off
```

> Sur Pi 3, l'Ethernet passe par le même contrôleur USB que l'Arduino : préférer le Wi-Fi, ou ne pas faire transiter de gros transferts pendant le jeu.

---

## Étape 8 — IRQ de la carte son au-dessus de JACK

Repérer les IRQ du Pisound, **JACK en marche** :

```bash
grep -E 'DMA IRQ|spi' /proc/interrupts
```

Les deux lignes `DMA IRQ` dont le compteur grimpe vite (environ 375/s chacune à 48 kHz / 128) sont l'I2S audio ; `3f204000.spi` est le MIDI du Pisound.
Sur Pi 3B + Pisound avec le noyau RT 5.15 de Patchbox : **82, 83** et **111**.

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

sudo systemctl daemon-reload
sudo systemctl enable --now audio-irq-prio
```

Vérifier :
```bash
ps -eLo tid,rtprio,comm | grep -E 'irq/(82|83|111)-'    # rtprio 90
```

---

## Étape 9 — Lucibox (code + services)

```bash
sudo apt install -y git nodejs npm        # si absents
git clone https://github.com/AurelienConil/lucibox-4looper-pedal26.git ~/lucibox
cd ~/lucibox/node && npm install --omit=dev
```

Les units sont versionnées dans `script/` ; les limites RT sont déclarées dans `lucibox-pd.service` (`LimitRTPRIO=95`, `LimitMEMLOCK=infinity`), pas dans `limits.d`.

```bash
sudo cp ~/lucibox/script/lucibox-pd.service ~/lucibox/script/lucibox-node.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now lucibox-pd lucibox-node
```

- Pas de `CPUSchedulingPolicy` / `CPUSchedulingPriority` : Pd et libjack fixent eux-mêmes leurs priorités, la valeur systemd est écrasée (70 → 6 observé).
- `autostart.sh` doit faire `jack_wait -w` avant de lancer `pd -nogui -jack …`.
- `node` reste en ordonnancement normal : ne jamais le mettre en RT.

Vérifier :
```bash
systemctl is-active jack lucibox-pd lucibox-node
ps -eLo tid,cls,rtprio,comm | grep -E 'pd$' | grep FF   # un thread FF 75 (DSP) + le thread principal
grep -i 'realtime pri' /proc/$(pgrep -o -x pd)/limits   # 95
grep VmLck /proc/$(pgrep -o -x pd)/status               # non nul
ls /dev/ttyACM*                                         # Arduino vu
```

---

## Étape 10 — Hygiène des patchs Pd

- **Aucun `[print]` dans un flux continu** (potentiomètres, métros). Mettre les prints derrière un `[spigot]` de debug désactivé par défaut.
- Potentiomètres Arduino : zone morte côté Arduino (ex. n'envoyer que si |Δ| > 4) et/ou `[change]` côté Pd.
- Pas de lecture disque pendant le jeu : charger les échantillons au démarrage (`[soundfiler]`), enregistrer avec `[writesf~]`.
- Pas de rafales de messages à chaque bloc (`[metro 1]`, `[delay 0]` en boucle, grosses `[list]` itérées).

---

## Étape 11 — Test final

```bash
sudo reboot
```

Après redémarrage, patch en jeu, pendant 5 minutes :

```bash
sudo apt install -y rt-tests
sudo cyclictest -m -Sp90 -i200 -h400 -q -D 5m
```

- Latence max < ~100 µs : bon.
- Latence max > 300 µs : une IRQ ou un service non maîtrisé, reprendre les étapes 2 et 8.

Puis 30 minutes de jeu réel :

```bash
journalctl -u jack -b | grep -ic xrun       # 0
```

Charge CPU réelle (le moniteur Lucibox l'affiche aussi) :

```bash
vmstat 1 5                                  # colonne "id" = % inactif
```

---

## Étape 12 — Carte SD en lecture seule (quand tout est validé)

Après l'étape 3, les logs ne touchent plus la SD, mais d'autres écritures restent (logrotate, fake-hwclock, baux DHCP, random-seed systemd, historique bash, `git pull`…).
La seule garantie de **zéro écriture** est l'overlay : la racine devient en lecture seule, toutes les écritures vont en RAM et disparaissent au redémarrage.

```bash
sudo raspi-config nonint enable_overlayfs
sudo raspi-config nonint enable_bootro      # /boot en lecture seule aussi
sudo reboot
```

Vérifier :
```bash
mount | grep ' / '                          # overlay on / type overlay
```

Pour **modifier** le système ensuite (mise à jour du code, réglage) :

```bash
sudo raspi-config nonint disable_overlayfs
sudo raspi-config nonint disable_bootro
sudo reboot
# … git pull, modifications …
sudo raspi-config nonint enable_overlayfs
sudo raspi-config nonint enable_bootro
sudo reboot
```

> Bonus : avec l'overlay, couper le courant brutalement ne peut plus corrompre la carte.

---

## Annexe — Retour arrière

```bash
sudo cp /boot/config.txt.orig /boot/config.txt
sudo cp /etc/jackdrc.orig /etc/jackdrc
sudo rm /etc/systemd/journald.conf.d/volatile.conf && sudo systemctl enable --now rsyslog
sudo systemctl disable --now audio-irq-prio
sudo systemctl enable --now <service réactivé>
sudo reboot
```
