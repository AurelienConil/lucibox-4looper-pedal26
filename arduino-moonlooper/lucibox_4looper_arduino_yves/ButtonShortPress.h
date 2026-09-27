#ifndef BUTTONSHORTPRESS_H
#define BUTTONSHORTPRESS_H

#include "Arduino.h"

/*
Simple momentary button.
Sends one OSC message on press (value 1000) and one on release (value 0).
*/

struct ButtonShortPress {
  int pin;
  const char* oscAddress;
  bool currentState;
  bool lastState;

  ButtonShortPress(int p, const char* addr) : pin(p), oscAddress(addr), currentState(false), lastState(false) {}

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
