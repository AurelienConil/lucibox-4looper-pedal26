# Lucibox Monitor — Notes d'implémentation

## Architecture SSH

**Une seule connexion SSH** partagée par tous les modules (objet `ssh2` `Client`).  
SSH supporte le multiplexing nativement : plusieurs `conn.exec()` simultanés sur le même socket TCP.

- **3 canaux "stream" persistants** : `journalctl -f` pour node, pd, jack (XRUNs)
- **N canaux "one-shot"** pour les polls périodiques et les commandes boutons

Un seul point de reconnexion à gérer. En cas de coupure SSH, tous les streams tombent ensemble — comportement acceptable (le compteur XRUN est perdu, c'est OK).

---

## Module SSHPoller

Un module `SSHPoller` réutilisable pour toutes les métriques à intervalle régulier :

```
constructor(sshConn, command, intervalMs, parserFn)
start() / stop() / runOnce()
→ émet un event 'data' avec la valeur parsée
```

Instances à créer :
- CPU Temp — refresh 5s
- CPU Usage — refresh 5s
- Services status — refresh 5s
- RT Processes — refresh 10s
- Version git — au démarrage + après Git Pull

---

## Points d'attention par item

### A — CPU Usage : éviter `top -bn1`

`top -bn1` est lent (~1s de blocage) et son format varie selon la locale (`Cpu(s)` vs `%Cpu(s)`).

→ Préférer lire `/proc/stat` deux fois à 500ms d'intervalle, ou utiliser :
```bash
vmstat 1 2 | tail -1
```

---

### B — `chrt` avec `pgrep -x pd`

Comportement vérifié sur patchbox :
```
patch@patchbox:~ $ chrt -p $(pgrep -x pd)
pid 471's current scheduling policy: SCHED_FIFO
pid 471's current scheduling priority: 6
```

`pgrep -x pd` retourne un seul PID dans ce contexte → OK.  
Pour `node` : utiliser `pgrep -f "node main.js"` (peut retourner plusieurs PIDs si plusieurs instances).

→ Défensif : utiliser `pgrep -o -x pd` ou `pgrep -o -f "node main.js"` (`-o` = oldest, un seul PID garanti).

Format d'affichage cible : `SCHED_FIFO/6`, `SCHED_OTHER/0`, ou `not found` en rouge.

---

### C — Buffer des lignes `journalctl -f`

Au démarrage, `-n 100` envoie 100 lignes d'un coup. Pousser chaque ligne individuellement dans le widget blessed provoque des rendus inutiles.

→ Bufferiser : accumuler les lignes reçues, flusher vers le widget toutes les **50ms** via `setInterval`.

---

### D — Détection du scroll manuel dans blessed

`blessed` n'a pas d'event natif "l'utilisateur a scrollé vers le haut".

→ Intercepter les events `wheelup` et `keypress` (touches `↑`, `PgUp`) sur le widget log et poser un flag `userScrolled = true`.  
→ Reprendre l'auto-scroll sur `wheeldown`, touche `End`, ou retour au bas de la liste.

---

### E — Reconnexion SSH

Si le RPi redémarre ou si la connexion coupe, tous les streams tombent.  
Comportement attendu : perte du compteur XRUN acceptable.

→ Implémenter une reconnexion avec **backoff exponentiel** (ex. 1s, 2s, 4s, 8s, max 30s).  
→ À la reconnexion, réinitialiser le compteur XRUN à 0 (comportement déjà prévu dans le spec).  
→ Afficher l'état de connexion dans le header : `[SSH Connected]` / `[Reconnecting…]` / `[SSH Error]`.

---

### F — `sudo systemctl restart` sans mot de passe

Le sudoers du RPi est configuré avec `NOPASSWD` pour `systemctl`.  
Les canaux `exec` de `ssh2` n'ont pas de TTY — un prompt mot de passe échouerait silencieusement.

→ Vérifier la présence du `NOPASSWD` dans l'écran Config (déjà prévu dans le spec).  
→ Si la commande échoue (code retour non-zéro), afficher une erreur visible dans le status.
