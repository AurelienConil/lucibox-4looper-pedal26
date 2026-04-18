#ifndef BUTTONFOOTHACK_H
#define BUTTONFOOTHACK_H

#include "Arduino.h"

/*
This classe serve an non momentary footswitch as a momentary footswitch.
This class send "1000" when status change.
There is no release artefact.


*/

struct ButtonFootHack {
  int pin;
  String oscAddress;
  bool currentState;
  bool lastState;
  
  ButtonFootHack(int p, String addr) : pin(p), oscAddress(addr), currentState(false), lastState(false) {}
  
  void init() {
    pinMode(pin, INPUT_PULLUP);
    currentState = !digitalRead(pin); // Logique inversée
    lastState = currentState;
  }
  
  bool hasChanged() {
    bool newState = !digitalRead(pin);
    if (newState != currentState) {
      currentState = newState;
      return true;
    }
    return false;
  }
  
  void sendOSC() {
    Serial.print(oscAddress);
    Serial.print(" ");
    Serial.print(1000 );
    Serial.println();
    lastState = currentState;
  }
};

#endif