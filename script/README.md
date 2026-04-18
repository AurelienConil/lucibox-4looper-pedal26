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
