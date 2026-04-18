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

### 1. Groupes requis pour l'utilisateur `patch`

```bash
# Vérifier les groupes actuels
groups patch

# L'utilisateur doit appartenir à : audio, jack (et optionnellement realtime)
sudo usermod -aG audio patch
sudo usermod -aG jack patch

# Appliquer sans reboot (ou reboot pour être sûr)
newgrp audio
```

### 2. Limites RT dans `/etc/security/limits.conf`

Vérifier que ces lignes sont présentes :

```bash
cat /etc/security/limits.conf | grep -E 'audio|patch|rtprio|memlock'
```

Si manquantes, les ajouter :

```bash
sudo tee -a /etc/security/limits.conf <<EOF
@audio   -  rtprio   95
@audio   -  memlock  unlimited
@jack    -  rtprio   95
@jack    -  memlock  unlimited
EOF
```

> Sur Patchbox OS, ces limites sont normalement déjà configurées dans `/etc/security/limits.d/`.

### 3. Governor CPU en mode `performance`

```bash
# Vérifier
cat /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor

# Forcer (temporaire, reboot remet ondemand)
echo performance | sudo tee /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor

# Rendre permanent via /etc/rc.local ou un service systemd
```

### 4. Noyau PREEMPT_RT

Patchbox OS embarque déjà un noyau RT. Vérifier :

```bash
uname -a           # doit contenir "PREEMPT_RT" ou "PREEMPT RT"
cat /sys/kernel/realtime   # doit afficher "1"
```

### 5. Priorité RT gérée par systemd (pas par `chrt` ni `-rt`)

Le flag `-rt` de pd et `chrt` échouent tous deux quand le process tourne sous un user non-root dans systemd (erreur `Operation not permitted`).

La solution correcte est de déléguer le RT à systemd dans `lucibox-pd.service` :

```ini
CPUSchedulingPolicy=fifo
CPUSchedulingPriority=70
LimitMEMLOCK=infinity
AmbientCapabilities=CAP_SYS_NICE
SecureBits=keep-caps
```

- `CPUSchedulingPolicy=fifo` + `CPUSchedulingPriority=70` : systemd applique SCHED_FIFO avant l'exec (droits root)
- `LimitMEMLOCK=infinity` : permet à JACK de verrouiller sa mémoire en RAM
- `AmbientCapabilities=CAP_SYS_NICE` : permet à pd de configurer ses threads JACK clients en RT en interne

Résultat attendu (`ps -eLo pid,comm,cls,rtprio`) :
```
jackd   FF  95   ← serveur JACK
pd      FF   6   ← thread audio client JACK (priorité assignée par le serveur)
```

---

## Diagnostic et vérification du temps réel

### Vérifier que JACK et pd tournent en RT

```bash
# Scheduling effectif de chaque process (FF = SCHED_FIFO = RT)
ps -eLo pid,comm,cls,rtprio | grep -E 'jackd|pd'

# Détail pour jackd
chrt -p $(pgrep jackd)
# attendu : SCHED_FIFO, priorité 95

# Détail pour pd
chrt -p $(pgrep -x pd)
# attendu : SCHED_FIFO, priorité 70
```

### Vérifier les limites RT actives

```bash
sudo -u patch bash -c "ulimit -a" | grep -E 'real-time|memory'
# real-time priority (-r) doit être 95
# max locked memory (-l) doit être unlimited
```

### Compter les xruns JACK

```bash
# Logs en temps réel
journalctl -u jack.service -f | grep -i xrun

# Xruns depuis le démarrage
journalctl -u jack.service --no-pager | grep -c xrun
```

### Tester la latence RT du noyau (outil de référence)

```bash
# Installer si absent
sudo apt install rt-tests

# Lancer le test (30 secondes, priorité 80)
sudo cyclictest -l 60000 -m -n -p 80 -i 500 --quiet
# Max latency < 200µs = bon, > 1000µs = problème noyau
```

### Résumé des causes fréquentes de xruns

| Cause | Vérification |
|---|---|
| `pd` en SCHED_OTHER (pas RT) | `chrt -p $(pgrep -x pd)` |
| CPU en mode `ondemand` | `cat /sys/.../scaling_governor` |
| Noyau non-RT | `cat /sys/kernel/realtime` |
| `rtprio` manquant dans limits | `ulimit -r` |
| Buffer JACK trop petit | `jack_control dg period` (essayer 256 → 512) |
