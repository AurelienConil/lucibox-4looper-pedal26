# Heartbeat Arduino — Spec firmware

## Pourquoi

Le Node.js embarque un watchdog qui surveille la réception série. Si aucun message n'arrive depuis 15 secondes, il suppose que le parser est mort et le réinitialise. Pour que ce watchdog soit fiable, l'Arduino doit émettre un message périodique même en l'absence d'interaction.

## Message à envoyer

```
/lucibox/ping 0
```

- Délimiteur de fin de ligne : `\n` (LF seul, pas CRLF)
- Fréquence : **toutes les 10 secondes**
- Format identique aux autres messages OSC-série du projet

## Comportement côté Node

Le message `/lucibox/ping` est ignoré silencieusement — il ne déclenche aucun callback applicatif, il sert uniquement à réinitialiser le timer du watchdog.

## Exemple firmware Arduino (C++)

```cpp
unsigned long lastHeartbeat = 0;
const unsigned long HEARTBEAT_INTERVAL = 10000; // 10s

void loop() {
  unsigned long now = millis();
  if (now - lastHeartbeat >= HEARTBEAT_INTERVAL) {
    lastHeartbeat = now;
    Serial.println("/lucibox/ping 0");
  }
  // ... reste du loop
}
```
