#ifndef LUCIBOX_H
#define LUCIBOX_H

#include "Arduino.h"
#include "Adafruit_NeoPixel.h"

#define MAX_VALUES     10

// Inclure les classes
#include "Potentiometer.h"
#include "Button.h"
#include "ButtonFootHack.h"
#include "LedStrip.h"

// Variables globales pour le parsing des valeurs
extern int valueCount;
extern int values[MAX_VALUES];

// Fonctions utilitaires
void handleIncomingOSC();
void parseOSCMessage(String message);
void handleLedPattern(String message);

#endif