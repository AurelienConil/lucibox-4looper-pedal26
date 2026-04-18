#ifndef LEDSTRIP_H
#define LEDSTRIP_H

#include "Arduino.h"
#include "Adafruit_NeoPixel.h"

// Configuration globale
#define PIN            12
#define NUMPIXELS      12
//#define INVERT // Uncomment if the fisrt pixels is n° 0 or N° 11

struct LedStrip {
  int ledStates[NUMPIXELS];
  Adafruit_NeoPixel pixels = Adafruit_NeoPixel(NUMPIXELS, PIN, NEO_RGB + NEO_KHZ800);
  int ledStrip1DotLooper[NUMPIXELS];
  int ledStrip3DotsLooper[NUMPIXELS];
  int ledStripSelection[NUMPIXELS];

  
  LedStrip() {
    pixels.begin();
    for(int i = 0; i < NUMPIXELS; i++) {
      ledStates[i] = 0;
      ledStrip1DotLooper[i]=0;
      ledStrip3DotsLooper[i]=0;
      ledStripSelection[i]=0;
    }
  }

  void clear() {
    
    for(int i = 0; i < NUMPIXELS; i++) {
      ledStates[i] = 0;
    }
    update();
  }
  
  void setLed(int index, int colorIndex) {
    if(index >= 0 && index < NUMPIXELS) {
      ledStates[index] = colorIndex;
    }
  }

  void setFader(int pourcentage, int colorIndex) {
    //use strip led as led fader. Use in pourcentage
    int index = (pourcentage * NUMPIXELS) / 100;
    clear();
    for (int i = 0; i < index; i++) {
      ledStates[i] = colorIndex;
    }
    update();
  }

  void set1DotLooper(int index, int value) {
    if(index >= 0 && index < NUMPIXELS) {
      ledStrip1DotLooper[index] = value;
    }
  }

  void update1DotLooper() { 
    for (int i = 0; i < NUMPIXELS; i++) {
      setColorNeoPixel(i, ledStrip1DotLooper[i]);
    }
    pixels.show();
  }

  void set3DotsLooper(int index, int channel, int value) {
    int finalIndex = index * 3 + channel;
    if(finalIndex >= 0 && finalIndex < NUMPIXELS) {
      ledStrip3DotsLooper[finalIndex] = value;
    }
  }

  void update3DotsLooper() {
    for (int i = 0; i < NUMPIXELS; i++) {
      setColorNeoPixel(i, ledStrip3DotsLooper[i]);
    }
    pixels.show();
  }

  void setSong(int index, int value) {
    // Song don't need to be updated. Don't need to save current state in a virtual led strip
    // -> draw it directly
    int selectedColor = 0;
    
    switch(value) {
      case 0: selectedColor = 0; break;
      case 1: selectedColor = 7; break; // Green means "loading"
      case 2: selectedColor = 2; break; // Red means "recording"
    }
    
    for (int i = 0; i < NUMPIXELS; i++) {
      int finalColor = 0;
      if(i == index) finalColor = 5; // Blue;
      setColorNeoPixel(i, finalColor);
    }
    pixels.show();
  }
  
  void update() {
    // Serial.print("#led state=[");
    for(int i = 0; i < NUMPIXELS; i++) {
      setColorNeoPixel(i, ledStates[i]);
      //Serial.print(ledStates[i]);
    }
    //Serial.println("]");
    pixels.show();
  }
  

  
  void setColorNeoPixel(int channel, int colorIndex) {
    int finalr = 0, finalg = 0, finalb = 0;
    
    if(channel >= 0 && channel < NUMPIXELS) {
      switch(colorIndex) {
        case 0: // OFF
          finalr = 0; finalg = 0; finalb = 0;
          break;
        case 1: // MEDIUM RED
          finalr = 0; finalg = 25; finalb = 0;
          break;
        case 2: // RED
          finalr = 0; finalg = 35; finalb = 0;
          break;
        case 3: // LIGHT WHITE
          finalr = 2; finalg = 2; finalb = 2;
          break;
        case 4: // MEDIUM WHITE
          finalr = 30; finalg = 30; finalb = 30;
          break;
        case 5: // BLUE
          finalr = 0; finalg = 0; finalb = 25;
          break;
        case 6: // YELLOW
          finalr = 12; finalg = 12; finalb = 0;
          break;
        case 7: // GREEN
          finalr = 25; finalg = 0; finalb = 0;
          break;
      }
#ifdef INVERT
      pixels.setPixelColor(NUMPIXELS - (channel + 1), pixels.Color(finalr, finalg, finalb));
#else
      pixels.setPixelColor(channel , pixels.Color(finalr, finalg, finalb));
#endif
    }
  }
};

#endif