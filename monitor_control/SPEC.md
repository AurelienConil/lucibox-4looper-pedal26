# Lucibox Monitor TUI — Specification

> App Node.js + blessed, lancée sur Mac, connexion SSH au Raspberry Pi.  
> Fournit un monitoring temps réel des services audio Lucibox.

---

## Vue d'ensemble

| Attribut | Valeur |
|---|---|
| Plateforme cible | macOS (terminal local) |
| Machine distante | Raspberry Pi — `patchbox.local`, user `patch` |
| Connexion | SSH via `ssh2` npm, credentials dans `monitor_config.json` |
| Stack TUI | Node.js + `blessed` + `blessed-contrib` |
| Nombre d'écrans | 2 : **Runtime** (principal) et **Config** (diagnostic, usage rare) |

---

## Fichier de configuration locale

`monitor_control/monitor_config.json` — créé au premier lancement si absent, stocké localement sur Mac.

```json
{
  "host": "patchbox.local",
  "port": 22,
  "username": "patch",
  "password": "raspberry"
}
```

Au démarrage, si le fichier est absent ou incomplet, l'app affiche un formulaire de saisie avant de se connecter.

---

## Écran 1 — Runtime (écran par défaut)

### Layout général

```
┌──────────────────────────────────────────────────────────────────────┐
│  LUCIBOX MONITOR — patch@patchbox.local              [SSH Connected]  │
├──────────────────┬───────────────────────┬───────────────────────────┤
│  STATUS          │  lucibox-node         │  lucibox-pd               │
│                  │  [ Restart Node ]     │  [ Restart PD ]           │
│ jack        ✓   │                       │                           │
│ node        ✓   │  [INFO] ArduinoMgr…   │  print: metro 120         │
│ pd          ✓   │  [WARN] serial slow   │  error: no such object    │
│                  │  [INFO] OSC rcv       │  … (scroll live)          │
│ CPU Temp: 52°C  │  … (scroll live)      │                           │
│ CPU Usage: 23%  │                       │                           │
│ XRUNs: 0        │                       │                           │
│                  │                       │                           │
│ RT Processes:   │                       │                           │
│  pd  SCHED_FF70 │                       │                           │
│  node SCHED_OT  │                       │                           │
│                  │                       │                           │
│ Version:        │                       │                           │
│ a3f1d2c         │                       │                           │
│ "fix loop sync" │                       │                           │
│                  │                       │                           │
│ [ Restart PD ]  │                       │                           │
│ [ Restart Node ]│                       │                           │
│ [ Reboot RPi ]  │                       │                           │
│ [ Git Pull ]    │                       │                           │
├──────────────────┴───────────────────────┴───────────────────────────┤
│  [c] Config    [r] Refresh    [q] Quit    [Tab] Focus logs           │
└──────────────────────────────────────────────────────────────────────┘
```

Ratio des colonnes (approximatif) : **25% / 37.5% / 37.5%**

---

### Colonne gauche — Status

#### Services (refresh : 5 s)
- `jack` — `systemctl is-active jack.service`
- `lucibox-node` — `systemctl is-active lucibox-node.service`
- `lucibox-pd` — `systemctl is-active lucibox-pd.service`
- Chaque ligne : icône vert (actif) ou rouge (inactif/failed)

#### Métriques système (refresh : 5 s)
- **CPU Temp** — `cat /sys/class/thermal/thermal_zone0/temp` → divisé par 1000 → affiché en °C
- **CPU Usage** — `top -bn1 | grep "Cpu(s)"` → % utilisé moyen tous cores

#### Compteur XRUN (live)
- Source : stream `journalctl -u jack.service -f`
- Parsing : toute ligne contenant le mot `xrun` (insensible à la casse) incrémente le compteur
- Affiché comme `XRUNs: N` — compteur remis à zéro à la reconnexion SSH, pas entre refreshs

#### RT Processes (refresh : 10 s)
- Pour `pd` : `chrt -p $(pgrep -x pd)` → extrait politique + priorité
- Pour `node` : `chrt -p $(pgrep -f "node main.js")` → idem
- Affichage court : `SCHED_FIFO/70`, `SCHED_OTHER`, ou `not found` en rouge

#### Version (au démarrage + après Git Pull)
- Commande : `git -C /home/patch/lucibox log -1 --format="%h %s"`
- Affiche hash court + message du dernier commit

#### Boutons d'action (bas de colonne)

| Bouton | Action SSH | Confirmation requise |
|---|---|---|
| `[ Restart PD ]` | `sudo systemctl restart lucibox-pd.service` | Non |
| `[ Restart Node ]` | `sudo systemctl restart lucibox-node.service` | Non |
| `[ Reboot RPi ]` | `sudo reboot` | **Oui** — popup `[Yes] [No]` |
| `[ Git Pull ]` | `git -C /home/patch/lucibox pull` puis refresh version | **Oui** — popup `[Yes] [No]` |

---

### Colonne centrale — Logs lucibox-node

- **Source** : `journalctl -u lucibox-node.service -f -n 100` (stream SSH persistant)
- **Bouton en haut** : `[ Restart Node ]` — identique au bouton de la colonne status
- **Coloration des lignes** :
  - `[ERROR]` → rouge
  - `[WARN]` → jaune
  - `[INFO]` → vert clair
  - `[VERBOSE]` → gris
  - Autres → blanc
- **Scroll** : auto-scroll vers le bas en continu. Si l'utilisateur scrolle manuellement vers le haut → auto-scroll suspendu. Reprend automatiquement en revenant en bas (ou touche `End`)

---

### Colonne droite — Logs lucibox-pd

- **Source** : `journalctl -u lucibox-pd.service -f -n 100` (stream SSH persistant)
- **Bouton en haut** : `[ Restart PD ]` — identique au bouton de la colonne status
- **Coloration des lignes** :
  - Ligne contenant `error:` ou `Error` → rouge
  - Ligne contenant `print:` → blanc
  - Autres → cyan/gris
- **Scroll** : même comportement que la colonne node

---

### Barre de statut (bas d'écran)

```
[c] Config    [r] Refresh    [q] Quit    [Tab] Focus logs
```

- `c` → bascule vers l'écran Config
- `r` → relance tous les polls status (services, temp, cpu, RT processes, version)
- `q` → ferme l'app proprement (ferme les streams SSH)
- `Tab` → déplace le focus clavier entre les deux colonnes de logs (pour le scroll)

---

## Écran 2 — Config System Check

**Accès** : touche `c` depuis Runtime, ou automatiquement si `monitor_config.json` est absent.  
**Retour** : touche `Echap` ou bouton `[ → Runtime ]`

### Layout

Liste verticale scrollable. Chaque ligne = un item de vérification avec statut coloré :
- ✓ vert — OK
- ✗ rouge — Problème détecté
- ⚠ jaune — Avertissement / valeur inattendue

```
┌─────────────────────────────────────────────────────────┐
│  LUCIBOX — System Config Check            [ → Runtime ] │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  OS                                                     │
│   ✓  Debian GNU/Linux 11 (bullseye)                    │
│                                                         │
│  Kernel                                                 │
│   ✓  5.15.32-rt39-v7l+  (PREEMPT RT détecté)          │
│                                                         │
│  CPU Governor                                           │
│   ✓  cpu0: performance                                  │
│   ✓  cpu1: performance                                  │
│   ✓  cpu2: performance                                  │
│   ✓  cpu3: performance                                  │
│                                                         │
│  Groupes user patch                                     │
│   ✓  audio                                             │
│   ✓  jack                                              │
│                                                         │
│  RT Limits (/etc/security/limits.conf)                  │
│   ✓  @audio rtprio 99                                  │
│   ✓  @audio memlock unlimited                          │
│                                                         │
│  Services                                               │
│   ✓  jack          active                              │
│   ✓  lucibox-node  active                              │
│   ✓  lucibox-pd    active                              │
│                                                         │
│  Port série Arduino                                     │
│   ✓  /dev/ttyACM0  détecté                             │
│                                                         │
│  Sudoers (systemctl sans mot de passe)                  │
│   ✓  patch ALL=(ALL) NOPASSWD: /bin/systemctl          │
│                                                         │
│  [ Refresh ]                    [ → Runtime ]           │
└─────────────────────────────────────────────────────────┘
```

### Checks effectués

| Section | Item vérifié | Commande SSH | Critère OK |
|---|---|---|---|
| **OS** | Distrib + version | `cat /etc/os-release` | Affiché, pas de critère strict |
| **Kernel** | Nom du kernel | `uname -r` | Contient `rt` ou `RT` → PREEMPT RT |
| **CPU Governor** | Politique par core | `cat /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor` | Tous = `performance` |
| **Groupes** | User `patch` dans `audio` et `jack` | `groups patch` | Les deux présents |
| **RT Limits** | rtprio, memlock dans limits.conf | `grep -E 'rtprio\|memlock' /etc/security/limits.conf` | Les deux lignes présentes |
| **Services** | jack, node, pd actifs | `systemctl is-active <service>` | Retourne `active` |
| **Port série** | Arduino détecté | `ls /dev/ttyACM* /dev/ttyUSB* 2>/dev/null` | Au moins un fichier trouvé |
| **Sudoers** | `systemctl` sans password | `sudo -n systemctl status 2>&1` | Pas de message "password required" |

---

## Comportements transversaux

### Connexion SSH

- Au démarrage, tentative de connexion avec les credentials de `monitor_config.json`
- Si connexion échoue → message d'erreur + retry toutes les 5 s
- Si SSH drop en cours d'utilisation → bannière rouge "SSH Disconnected — Reconnecting…" + retry toutes les 5 s
- Les streams journalctl sont rouverts à chaque reconnexion

### Taille minimale du terminal

- Si le terminal est < 120 colonnes × 40 lignes → avertissement affiché, layout potentiellement dégradé

### Popups de confirmation

- Pour Reboot RPi et Git Pull : dialog centré `"Confirmer : <action> ?" [Yes] [No]`
- Focus clavier sur `[No]` par défaut (fail-safe)

---

## Structure des fichiers de l'app (à implémenter)

```
monitor_control/
  SPEC.md                  ← ce fichier
  monitor_config.json      ← credentials SSH (local Mac, gitignore)
  package.json
  index.js                 ← point d'entrée, init blessed, routing écrans
  screens/
    runtime.js             ← écran Runtime
    config.js              ← écran Config Check
  modules/
    ssh.js                 ← gestion connexion SSH, streams, exec
    status.js              ← polling services, temp, cpu, RT, version
    xrun.js                ← compteur XRUN depuis stream journalctl jack
```

---

## Dépendances npm prévues

| Package | Usage |
|---|---|
| `blessed` | TUI boxes, scrollable log panels, boutons, popups |
| `blessed-contrib` | Widgets complémentaires si nécessaire |
| `ssh2` | Connexion SSH, exec() pour commandes ponctuelles, shell() pour streams |
