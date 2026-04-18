/*
 *        LUCIBOX Looper 4 channel - OSC Version
 *        Moonloop version
 *        
 *        Author : Aurelien Conil
 *        aurelienconil.fr
 */

#include "lucibox.h"

// Variables globales
int valueCount = 0;
int values[MAX_VALUES];

// Serial handshake
bool serialHandshake = false;
unsigned long startTime;
unsigned long timeout = 30000; // 30 secondes

// Heartbeat
unsigned long lastHeartbeat = 0;
const unsigned long HEARTBEAT_INTERVAL = 10000; // 10s

// Instance du NeoPixel (doit être globale pour être accessible par LedStrip)

// Instances des contrôleurs
Potentiometer potars[] = {
  Potentiometer(A0, "/lucibox/potar1"),
  Potentiometer(A1, "/lucibox/potar2"),
  Potentiometer(A2, "/lucibox/potar3"),
};

Button buttons[] = {
  

  Button(3, "/lucibox/loop/channel1/play"),
  Button(5, "/lucibox/loop/channel2/play"),
  Button(7, "/lucibox/loop/channel3/play"),
  Button(9, "/lucibox/loop/channel4/play"),
  Button(10, "/lucibox/global/play")
  
};


//This is rec only as it does not have 'long press' detection
ButtonFootHack buttonsFootHack[] = {
  
  ButtonFootHack(2, "/lucibox/loop/channel1/rec"),
  ButtonFootHack(4, "/lucibox/loop/channel2/rec"),
  ButtonFootHack(6, "/lucibox/loop/channel3/rec"),
  ButtonFootHack(8, "/lucibox/loop/channel4/rec"),

};

LedStrip ledStrip;

const int NUM_POTARS = sizeof(potars) / sizeof(potars[0]);
const int NUM_BUTTONS = sizeof(buttons) / sizeof(buttons[0]);
const int NUM_BUTTONSFOOTHACK = sizeof(buttonsFootHack) / sizeof(buttonsFootHack[0]);

//---------------------------------------------------------
//          MAIN
//---------------------------------------------------------

void setup() {
  

  
  // Try to connect to serial . Display something until the serial is connected
  Serial.begin(38400);
  delay(5);


  Serial.println("# LUCIBOX OSC Interface Ready");
  //ledStrip.clear();


    // Initialisation des potentiomètres
  for(int i = 0; i < NUM_POTARS; i++) {
    potars[i].init();
  }
  
  // Initialisation des boutons
  for(int i = 0; i < NUM_BUTTONS; i++) {
    buttons[i].init();
  }

  // Initialisation des boutons Foot Hack
  for(int i = 0; i < NUM_BUTTONSFOOTHACK; i++) {
    buttonsFootHack[i].init();
  }

    // Initialisation des LEDs
  ledStrip.pixels.begin();
  ledStrip.setFader(0,2);

  unsigned long startTime = millis();
  unsigned long timeout = 30000; // 30 secondes


}

void loop() {
  // Lecture des potentiomètres
  for(int i = 0; i < NUM_POTARS; i++) {
    if(potars[i].hasChanged()) {
      potars[i].sendOSC();
    }
  }
  
  // Lecture des boutons
  for(int i = 0; i < NUM_BUTTONS; i++) {
    bool result = buttons[i].hasChanged();
    if(result) {
      buttons[i].sendOSC();
    }
  }

  // Lecture des boutons Hack Footswitch
  for(int i = 0; i < NUM_BUTTONSFOOTHACK; i++) {
    bool result = buttonsFootHack[i].hasChanged();
    if(result) {
      buttonsFootHack[i].sendOSC();
    }
  }
  
  // Gestion des messages OSC entrants pour LEDs
  handleIncomingOSC();

  // Heartbeat watchdog
  unsigned long now = millis();
  if (now - lastHeartbeat >= HEARTBEAT_INTERVAL) {
    lastHeartbeat = now;
    Serial.println("/lucibox/ping 0");
  }

  if( !serialHandshake && ((millis() - startTime) < timeout )) {
    // Attente de la connexion série avec effet de "fader"
      // Calcul du pourcentage en fonction du temps écoulé
      int percentage = map(millis() - startTime, 0, timeout, 0, 100);
      ledStrip.setFader(percentage, 2); // Affiche le pourcentage avec la fonction "fader"
      delay(100); // Petit délai pour éviter une mise à jour trop rapide
  }

  delay(5);
}

void handleIncomingOSC() {
  if(Serial.available() > 0) {

    String message = Serial.readStringUntil('\n');
    message.trim();
    
    if(message.length() > 0) {
      parseOSCMessage(message);
    }
  }
}

void parseOSCMessage(String message) {
  // "message" est une chaine de caractère "/mon/adresse/ici value1 value2 value3"
  // On considere que value sont de "int"
  // On cherche donc à séparer dynamiquement msg + value[]

  valueCount = 0; // Réinitialise le compteur de valeurs
  // Trouver l'index de la fin de l'adresse
  int addressEndIndex = message.indexOf(' ');

  // Si aucun espace n'est trouvé, il n'y a pas de valeurs
  if (addressEndIndex == -1) {
    return;
  }

  int startIndex = addressEndIndex + 1;  // Commence la recherche des values après l'adresse
  int spaceIndex;

  // Boucle pour extraire les valeurs
  while ((spaceIndex = message.indexOf(' ', startIndex)) != -1 && valueCount < MAX_VALUES) {
    values[valueCount] = message.substring(startIndex, spaceIndex).toInt();
    valueCount++;
    startIndex = spaceIndex + 1;
  }

  // Ajoute la dernière valeur
  if (startIndex < message.length() && valueCount < MAX_VALUES) {
    values[valueCount] = message.substring(startIndex).toInt();
    valueCount++;
  }

  // -------------- STRIP ONE ------------------------
  if(message.startsWith("/lucibox/led/strip/one")) {
    // Format attendu: "/lucibox/led/set index color"
    // Exemple: "/lucibox/led/set 0 2" (LED 0 en rouge)
    Serial.println("#receive lucibox-ledstrip-set");
        
    if(valueCount == 2) {
      int ledIndex = values[0];
      int colorValue = values[1];
      
      Serial.println("#set led");
      ledStrip.setLed(ledIndex, colorValue);
      Serial.println("#update led");
      ledStrip.update();
    }
  }
  // -------------- CLEAR ------------------------
  else if(message.startsWith("/lucibox/led/strip/clear")) {
    // Valider le handshake spécifiquement sur la commande clear
      ledStrip.clear();
  }

  // -------------- INIT ------------------------
  else if(message.startsWith("/lucibox/init")) {
    // Valider le handshake spécifiquement sur la commande init
    if(!serialHandshake) {
      serialHandshake = true;
      Serial.print("# Handshake validated at ");
      Serial.print(millis());
      Serial.println("ms");
      
      // Force clear immédiatement après handshake pour stopper le fader
      ledStrip.clear();
      Serial.println("# Fader stopped and cleared");
    }
    
    Serial.print("# Init system at ");
    Serial.print(millis());
    Serial.println("ms");
    
    // 1. Clear du ruban LED
    ledStrip.clear();
    
    // 2. Envoyer toutes les valeurs actuelles des potentiomètres
    Serial.println("# Sending all potentiometer values");
    for(int i = 0; i < NUM_POTARS; i++) {
      potars[i].sendCurrentValue();
    }
    Serial.println("# Init completed");
  }
  // -------------- LOOPER  ------------------------
  else if(message.startsWith("/lucibox/led/strip/looper")) {  
    // Pattern pour looper: affiche le statut des 4 channels
    // Format attendu: "/lucibox/led/strip/looper looperchannel ledindex value"

    if(valueCount == 3) {
      int index = values[0] - 1; // Channel1 is index0 
      int ledindex = values[1];
      int value = values[2];

      if(index >= 0) ledStrip.set3DotsLooper(index, ledindex, value);
      ledStrip.update3DotsLooper();
    }
  }
  else if(message.startsWith("/lucibox/led/strip/level")) {
    // Pattern niveau: affiche une barre de niveau
    if(valueCount == 1) {
      int index = values[0] ;
      ledStrip.setFader(index, 5);
    }
  }
}

