================================================================
LUCIBOX — PRÉCONISATIONS CORRECTION BUG RÉCEPTION SERIAL
================================================================
Symptôme : après ~10 min, l'Arduino cesse d'émettre des données
vers Node.js. Aucune erreur, pas de déconnexion, l'émission
(Node → Arduino) continue de fonctionner.
================================================================


----------------------------------------------------------------
CAUSE IDENTIFIÉE — Double ReadlineParser (priorité CRITIQUE)
----------------------------------------------------------------

Dans ArduinoManager.js, le flux de réception est cassé par une
double connexion du parser sur le même port série.

Déroulement du problème :

1. testPort() ouvre le port et branche un ReadlineParser via pipe()
2. Le handshake LUCIBOX est détecté → resolve(true)
   MAIS : le port n'est PAS fermé, le parser n'est PAS retiré
3. findAndConnect() reprend ce même port ouvert et appelle
   serialPort.pipe(new ReadlineParser(...)) une deuxième fois
4. Résultat : deux ReadlineParser lisent le même stream entrant
5. Les chunks de bytes sont répartis entre les deux de façon
   non déterministe → aucun des deux ne reçoit des lignes complètes
6. Les buffers internes s'accumulent indéfiniment, plus aucun
   événement 'data' n'est émis → silence total, sans erreur

L'émission (write) n'est pas affectée, ce qui explique que
Node → Arduino continue de fonctionner.


----------------------------------------------------------------
CORRECTION 1 — Réutiliser le port ouvert par testPort()
----------------------------------------------------------------

Modifier testPort() pour qu'il retourne le port déjà ouvert
au lieu de false/true, et que findAndConnect() ne recrée pas
de nouveau pipe dessus.

Approche recommandée :

  async testPort(serialPort) {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (serialPort.isOpen) serialPort.close();
        resolve(null); // échec → null
      }, 5000);

      const parser = serialPort.pipe(
        new ReadlineParser({ delimiter: '\n' })
      );

      const onData = (data) => {
        if (data.toString().trim().includes('LUCIBOX')) {
          clearTimeout(timeout);
          parser.removeAllListeners('data');
          serialPort.unpipe(parser); // ← retirer le pipe du test
          resolve(serialPort);       // ← retourner le port ouvert
        }
      };

      parser.on('data', onData);

      serialPort.on('error', () => {
        clearTimeout(timeout);
        if (serialPort.isOpen) serialPort.close();
        resolve(null);
      });
    });
  }

Dans findAndConnect(), adapter l'appel :

  const validPort = await this.testPort(serialPort);

  if (validPort) {
    // Créer le parser UNE SEULE FOIS sur le port déjà ouvert
    const parser = validPort.pipe(
      new ReadlineParser({ delimiter: '\n' })
    );

    parser.on('data', (data) => { ... });
    // NE PAS remettre un serialPort.on('open') ici
    // (le port est déjà ouvert, l'événement ne se déclenchera plus)

    this.serialPort = validPort;
    this.isConnected = true; // ← forcer ici, pas dans 'open'
    ...
  }


----------------------------------------------------------------
CORRECTION 2 — Fix de isConnected (bug secondaire)
----------------------------------------------------------------

Actuellement, this.isConnected = true est posé dans le callback
de l'événement 'open'. Or, au moment où ce listener est ajouté,
le port est DÉJÀ ouvert (il a survécu au handshake). L'événement
ne se redéclenchera jamais → isConnected reste false.

Fix : assigner isConnected = true directement après la validation
du handshake, comme montré dans la correction 1 ci-dessus.


----------------------------------------------------------------
CORRECTION 3 — Watchdog applicatif (si applicable)
----------------------------------------------------------------

Un watchdog basé sur 'close' ou les erreurs est inutile ici :
le port ne se ferme jamais et aucune erreur n'est levée.

La seule option viable est un timeout sur la réception :
si aucun message n'arrive depuis X secondes alors que l'Arduino
devrait en envoyer régulièrement, le parser est probablement mort.

CONDITION PRÉALABLE : l'Arduino doit émettre quelque chose de
périodique (heartbeat, état des pédales, etc.).

Si c'est le cas, ajouter dans ArduinoManager :

  this._lastMessageAt = Date.now();

  // Dans le callback parser.on('data') :
  this._lastMessageAt = Date.now();

  // Watchdog toutes les 15 secondes :
  this._watchdog = setInterval(() => {
    const silence = Date.now() - this._lastMessageAt;
    if (silence > 15000) { // 15s sans message
      logger.warn('Parser silencieux depuis ' + silence + 'ms — réinitialisation');
      this._restartParser();
    }
  }, 15000);

  // Méthode de réinitialisation du parser :
  _restartParser() {
    if (this.serialPort?.isOpen) {
      this.serialPort.unpipe();
      const parser = this.serialPort.pipe(
        new ReadlineParser({ delimiter: '\n' })
      );
      parser.on('data', (data) => {
        this._lastMessageAt = Date.now();
        if (this.messageCallback) this.messageCallback(data.trim());
      });
    }
  }

Si l'Arduino n'émet PAS de heartbeat régulier, envisager d'en
ajouter un côté firmware (ex: envoyer "/lucibox/ping 0" toutes
les 10 secondes).


----------------------------------------------------------------
ORDRE DE PRIORITÉ DES CORRECTIONS
----------------------------------------------------------------

1. [CRITIQUE]   Correction 1 — double pipe / port zombie
                → corrige très probablement le bug à 100%

2. [SECONDAIRE] Correction 2 — isConnected toujours false
                → nécessaire pour que le watchdog soit fiable

3. [OPTIONNEL]  Correction 3 — watchdog applicatif
                → filet de sécurité si le bug a une autre cause
                   ou réapparaît sous une autre forme


----------------------------------------------------------------
FICHIERS CONCERNÉS
----------------------------------------------------------------

  node/modules/ArduinoManager.js  ← modifications principales


================================================================