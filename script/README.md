# Services Lucibox sur Raspberry Pi

## Connexion SSH

```bash
ssh patch@patchbox.local
# password : raspberry
```

## Installation des services (première fois)

Copier les fichiers service dans systemd, puis activer :

```bash
sudo cp ~/lucibox/script/lucibox-pd.service /etc/systemd/system/
sudo cp ~/lucibox/script/lucibox-node.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable lucibox-pd.service lucibox-node.service
sudo systemctl start lucibox-pd.service lucibox-node.service
```

## Mise à jour des services

Si les fichiers `.service` sont modifiés dans le repo :

```bash
sudo cp ~/lucibox/script/lucibox-pd.service /etc/systemd/system/
sudo cp ~/lucibox/script/lucibox-node.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl restart lucibox-pd.service lucibox-node.service
```

## Commandes courantes

```bash
# Statut
sudo systemctl status lucibox-pd.service
sudo systemctl status lucibox-node.service

# Stop / Start
sudo systemctl stop lucibox-pd.service lucibox-node.service
sudo systemctl start lucibox-pd.service lucibox-node.service

# Logs
journalctl -u lucibox-pd.service -f
journalctl -u lucibox-node.service -f

# Ordre de démarrage au boot
systemd-analyze critical-chain lucibox-pd.service
```

## Dépendances

| Service | Attend |
|---|---|
| `lucibox-pd.service` | `jack.service` (JACK démarre en premier) |
| `lucibox-node.service` | `network.target` + `lucibox-pd.service` |

---

## Configuration OS pour l'audio temps réel

La configuration complète du système est décrite à la racine du repo :

- [`RPI_RT_SETUP.md`](../RPI_RT_SETUP.md) — installation depuis un Patchbox OS vierge ;
- [`RPI_RT_UPDATE_LUCIBOX.md`](../RPI_RT_UPDATE_LUCIBOX.md) — réalignement du Pi déjà en service.

Ce qui suit résume ce qui concerne directement ces services.

### Priorités temps réel

Ordre visé (du plus prioritaire au moins prioritaire) :

```
IRQ audio Pisound (DMA I2S + SPI)   FIFO 90   ← audio-irq-prio.service
jackd                               FIFO 80   ← /etc/jackdrc : -R -P 80
thread DSP de Pd (client JACK)      FIFO 75   (= priorité JACK − 5, fixé par libjack)
autres IRQ (USB, Wi-Fi, SD…)        FIFO 50   (défaut du noyau RT)
thread principal de Pd              FIFO bas  (fixé par Pd lui-même)
node                                normal    (jamais en RT)
```

Le DSP de Pd tourne dans le **thread client JACK**, pas dans le thread principal : c'est lui qu'il faut regarder.

### Limites RT dans `lucibox-pd.service`

`/etc/security/limits.d/audio.conf` (`@audio - rtprio 95`, `@audio - memlock unlimited`) ne s'applique qu'aux sessions de login, **pas aux services systemd**. Les limites sont donc déclarées dans l'unit :

```ini
LimitRTPRIO=95
LimitMEMLOCK=infinity
AmbientCapabilities=CAP_SYS_NICE
SecureBits=keep-caps
```

- `LimitRTPRIO=95` : autorise Pd et libjack à passer leurs threads en SCHED_FIFO.
- `LimitMEMLOCK=infinity` : autorise Pd à verrouiller sa mémoire en RAM (`mlockall`).
- `AmbientCapabilities=CAP_SYS_NICE` : filet de sécurité pour changer les priorités sans être root.
- Pas de `CPUSchedulingPolicy` / `CPUSchedulingPriority` : Pd et libjack fixent eux-mêmes leurs priorités, la valeur systemd serait écrasée.

Le groupe `dialout` est nécessaire pour l'Arduino (`/dev/ttyACM0`) :

```bash
groups patch                          # audio, jack, dialout
sudo usermod -aG audio,jack,dialout patch
```

---

## Diagnostic et vérification du temps réel

### Vérifier les priorités

```bash
ps -eLo tid,cls,rtprio,comm | grep -E 'jackd|pd$|irq/(82|83|111)-' | grep FF
```

Attendu :
```
irq/82-DMA IRQ    FF 90
irq/83-DMA IRQ    FF 90
irq/111-3f20400   FF 90
jackd             FF 80
pd                FF 75    ← thread DSP (client JACK)
pd                FF  6    ← thread principal
```

### Vérifier les limites effectives du process pd

```bash
grep -Ei 'realtime pri|locked' /proc/$(pgrep -o -x pd)/limits   # 95 / unlimited
grep VmLck /proc/$(pgrep -o -x pd)/status                       # non nul
```

(`ulimit -r` dans une session SSH montre les limites de session, pas celles du service.)

### Compter les xruns JACK

`/etc/jackdrc` ne doit **pas** contenir `-s` (softmode) : il masque les xruns.

```bash
journalctl -u jack.service -f | grep -i xrun          # en direct
journalctl -u jack.service -b | grep -ic xrun         # depuis le démarrage
```

### Tester la latence du noyau

```bash
sudo apt install rt-tests
sudo cyclictest -m -Sp90 -i200 -h400 -q -D 5m         # patch en jeu
# max < ~100 µs = bon ; > 300 µs = IRQ ou service non maîtrisé
```

### Causes fréquentes de xruns

| Cause | Vérification |
|---|---|
| Noyau non RT | `cat /sys/kernel/realtime` → 1 |
| CPU pas en `performance` ou throttling | `cat /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor`, `vcgencmd get_throttled` → 0x0 |
| Thread DSP de pd pas en FIFO | `ps -eLo tid,cls,rtprio,comm \| grep 'pd$'` → un FF 75 |
| `LimitRTPRIO` absent de l'unit | `grep -i 'realtime pri' /proc/$(pgrep -x pd)/limits` → 95 |
| IRQ audio sous les autres IRQ | `systemctl is-active audio-irq-prio`, priorités ci-dessus |
| `[print]` en continu dans un patch | `journalctl -u lucibox-pd -f` doit rester calme |
| Période JACK trop courte pour la charge | `/etc/jackdrc` : essayer `-p 256` |
