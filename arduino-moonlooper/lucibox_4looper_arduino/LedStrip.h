#ifndef LEDSTRIP_H
#define LEDSTRIP_H

#include "Arduino.h"
#include "Adafruit_NeoPixel.h"

// Configuration globale
#define PIN            12
#define NUMPIXELS      12
//#define INVERT // Uncomment if the fisrt pixels is n° 0 or N° 11

// Animation du blink (LEDs looper)
#define BLINK_HALF_PERIOD_MS 150   // durée d'une phase on ou off en clignotement infini
#define BLINK_TIMED_DURATION_MS 500 // durée totale du clignotement pour les modes 2 et 3

// Modes d'affichage des LEDs (une seule "vue" pilote physiquement le ruban à la fois)
enum LedDisplayMode {
  DISPLAY_NONE,
  DISPLAY_ONE,     // setLed / update()
  DISPLAY_LOOPER,  // set3DotsLooper (avec animation)
  DISPLAY_FADER,   // setFader
  DISPLAY_SONG     // setSong
};

// Etat d'une LED animée du looper : couleur cible + mode de clignotement + horodatage de départ
struct LedAnim {
  int colorIndex = 0;
  int mode = 0; // 0=fixe, 1=blink infini, 2=blink 500ms puis eteint, 3=blink 500ms puis allume
  unsigned long startTime = 0;
};

struct LedStrip {
  int ledStates[NUMPIXELS];
  Adafruit_NeoPixel pixels = Adafruit_NeoPixel(NUMPIXELS, PIN, NEO_RGB + NEO_KHZ800);
  int ledStrip1DotLooper[NUMPIXELS];
  LedAnim ledStrip3DotsLooper[NUMPIXELS];
  int ledStripSelection[NUMPIXELS];
  LedDisplayMode currentMode = DISPLAY_NONE;


  LedStrip() {
    pixels.begin();
    for(int i = 0; i < NUMPIXELS; i++) {
      ledStates[i] = 0;
      ledStrip1DotLooper[i]=0;
      ledStripSelection[i]=0;
    }
  }

  void clear() {
    currentMode = DISPLAY_NONE;
    for(int i = 0; i < NUMPIXELS; i++) {
      ledStates[i] = 0;
    }
    update();
  }

  void setLed(int index, int colorIndex) {
    currentMode = DISPLAY_ONE;
    if(index >= 0 && index < NUMPIXELS) {
      ledStates[index] = colorIndex;
    }
  }

  void setFader(int pourcentage, int colorIndex) {
    currentMode = DISPLAY_FADER;
    //use strip led as led fader. Use in pourcentage
    int index = (pourcentage * NUMPIXELS) / 100;
    for(int i = 0; i < NUMPIXELS; i++) {
      ledStates[i] = 0;
    }
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

  // mode: 0=fixe, 1=blink infini, 2=blink 500ms puis eteint, 3=blink 500ms puis allume
  void set3DotsLooper(int index, int channel, int value, int mode = 0) {
    currentMode = DISPLAY_LOOPER;
    int finalIndex = index * 3 + channel;
    if(finalIndex >= 0 && finalIndex < NUMPIXELS) {
      LedAnim &anim = ledStrip3DotsLooper[finalIndex];
      // On ne relance le chrono que si la couleur ou le mode change vraiment,
      // sinon un renvoi périodique du même état ferait repartir le blink de zéro.
      if(anim.colorIndex != value || anim.mode != mode) {
        anim.startTime = millis();
      }
      anim.colorIndex = value;
      anim.mode = mode;
    }
  }

  // A appeler à chaque tour de loop() : ne fait rien si le looper n'est pas
  // la vue courante (pour ne pas perturber setLed/clear/setFader/setSong).
  void tickLooperAnimation() {
    if(currentMode != DISPLAY_LOOPER) return;

    unsigned long now = millis();
    for (int i = 0; i < NUMPIXELS; i++) {
      LedAnim &anim = ledStrip3DotsLooper[i];
      unsigned long elapsed = now - anim.startTime;
      int displayColor = anim.colorIndex;

      switch(anim.mode) {
        case 0: // fixe
          displayColor = anim.colorIndex;
          break;
        case 1: // blink infini
          displayColor = isBlinkOnPhase(elapsed) ? anim.colorIndex : 0;
          break;
        case 2: // blink 500ms puis eteint
          displayColor = (elapsed >= BLINK_TIMED_DURATION_MS) ? 0 : (isBlinkOnPhase(elapsed) ? anim.colorIndex : 0);
          break;
        case 3: // blink 500ms puis allume
          displayColor = (elapsed >= BLINK_TIMED_DURATION_MS) ? anim.colorIndex : (isBlinkOnPhase(elapsed) ? anim.colorIndex : 0);
          break;
      }

      setColorNeoPixel(i, displayColor);
    }
    pixels.show();
  }

  bool isBlinkOnPhase(unsigned long elapsed) {
    return ((elapsed / BLINK_HALF_PERIOD_MS) % 2) == 0;
  }

  void setSong(int index, int value) {
    currentMode = DISPLAY_SONG;
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