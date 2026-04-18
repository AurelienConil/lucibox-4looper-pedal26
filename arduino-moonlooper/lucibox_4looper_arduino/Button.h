#ifndef BUTTON_H
#define BUTTON_H

#include "Arduino.h"

struct Button {
  int pin;
  String oscAddress;
  bool currentState;
  bool lastState;
  
  Button(int p, String addr) : pin(p), oscAddress(addr), currentState(false), lastState(false) {}
  
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
    Serial.print(currentState ? 1000 : 0);
    Serial.println();
    lastState = currentState;
  }
};

#endif