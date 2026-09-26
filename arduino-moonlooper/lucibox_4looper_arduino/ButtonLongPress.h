#ifndef BUTTONLONGPRESS_H
#define BUTTONLONGPRESS_H

#include "Arduino.h"

/*
Momentary button with short/long press detection.
- A short press+release (shorter than longPressDuration) sends one message
  on release, to oscAddressShort.
- Holding the button longer than longPressDuration fires one message
  immediately, to oscAddressLong. The following release then sends nothing.
There is no release message in either case.
*/

struct ButtonLongPress {
  int pin;
  const char* oscAddressShort;
  const char* oscAddressLong;
  unsigned long longPressDuration;
  bool currentState;
  bool lastState;
  unsigned long pressStartTime;
  bool longPressFired;
  bool pendingSend;
  bool pendingIsLong;

  ButtonLongPress(int p, const char* addrShort, const char* addrLong, unsigned long longMs = 600)
    : pin(p), oscAddressShort(addrShort), oscAddressLong(addrLong), longPressDuration(longMs),
      currentState(false), lastState(false), pressStartTime(0), longPressFired(false),
      pendingSend(false), pendingIsLong(false) {}

  void init() {
    pinMode(pin, INPUT_PULLUP);
    currentState = !digitalRead(pin); // Logique inversée
    lastState = currentState;
  }

  bool hasChanged() {
    bool newState = !digitalRead(pin);

    if (newState != currentState) {
      currentState = newState;
      lastState = currentState;

      if (currentState) {
        // Press: start timing, nothing to send yet.
        pressStartTime = millis();
        longPressFired = false;
      } else if (!longPressFired) {
        // Release before the long press threshold: short press.
        pendingSend = true;
        pendingIsLong = false;
      }
    } else if (currentState && !longPressFired && (millis() - pressStartTime >= longPressDuration)) {
      // Still held past the threshold: fire the long press now.
      longPressFired = true;
      pendingSend = true;
      pendingIsLong = true;
    }

    return pendingSend;
  }

  void sendOSC() {
    Serial.print(pendingIsLong ? oscAddressLong : oscAddressShort);
    Serial.print(" ");
    Serial.print(1000);
    Serial.println();
    pendingSend = false;
  }
};

#endif
