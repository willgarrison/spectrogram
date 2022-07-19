document.addEventListener("DOMContentLoaded", function () {
  // Create controls
  app.setupControls();

  // Add click to init audio setup
  document.body.addEventListener("click", app.init);
});

const app = {
  config: {
    /* duration
     * The duration of one screen cycle in seconds.
     */
    duration: 15,

    /*
		sampleRate
		Is it ok to set sampleRate? Might be set by system only.
		*/
    sampleRate: 22050, // Hz 11025, 22050, 44100

    /* 
		fftSize
		Must be a power of 2 between 2^5 and 2^15, so one of:
		32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384,
		and 32768. Defaults to 2048.
		*/
    fftSize: 2048,

    /* 
		smoothingTimeConstant
		A double within the range 0 to 1 (0 meaning no time
		averaging). The default value is 0.8. 
		*/
    smoothingTimeConstant: 0.1,

    /* 
		The minimum and maximum value for the range of results 
		when using getByteFrequencyData()

		minDecibels
		A double, representing the minimum decibel value for 
		scaling the FFT analysis data, where 0 dB is the loudest 
		possible sound, -10 dB is a 10th of that, etc. The default 
		value is -100 dB. 

		maxDecibels
		A double, representing the maximum decibel value for 
		scaling the FFT analysis data, where 0 dB is the loudest 
		possible sound, -10 dB is a 10th of that, etc. The default 
		value is -30 dB. 
		*/
    minDecibels: -100,
    maxDecibels: -70,

    /*
		UI
		*/
    peakBright: 255,
    midBright: 15,
    fillOpacity: 0.9,
  },

  controls: [
    {
      key: "fftSize",
      label: "FFT Size",
      min: 32,
      max: 32768,
      validValues: [32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768],
      precision: 0,
    },
    {
      key: "smoothingTimeConstant",
      label: "Smoothing Time Constant",
      min: 0,
      max: 1,
      step: 0.1,
      precision: 1,
    },
    {
      key: "minDecibels",
      label: "Min Decibels",
      min: -100,
      max: 0,
      step: 10,
      precision: 0,
    },
    {
      key: "maxDecibels",
      label: "Max Decibels",
      min: -100,
      max: 0,
      step: 10,
      precision: 0,
    },
    {
      key: "peakBright",
      label: "Peak Bright",
      min: 0,
      max: 255,
      step: 15,
      precision: 0,
    },
    {
      key: "midBright",
      label: "Mid Bright",
      min: 0,
      max: 255,
      step: 15,
      precision: 0,
    },
    {
      key: "fillOpacity",
      label: "Fill Opacity",
      min: 0,
      max: 1,
      step: 0.1,
      precision: 1,
    },    
  ],

  resizeCanvasTimeout: null,

  controlsVisible: false,

  audioCtx: null,
  analyser: null,
  source: null,
  spectrum: null,

  canvasOuter: null,
  canvasBox: null,
  canvasElement: null,
  canvasCtx: null,

  blockWidth: 1,
  blockHeight: 1,
  xPosition: 0,

  playing: false,
  fps: 24,
  fpsInterval: null,
  startTime: null,
  now: null,
  then: null,
  elapsed: null,
  frameCount: 0,
  fpsDebug: false,

  init: function () {
    // Remove click listener
    document.body.removeEventListener("click", app.init);

    // Older browsers might not implement mediaDevices at all, so we set an empty object first
    if (navigator.mediaDevices === undefined) {
      navigator.mediaDevices = {};
    }

    // Some browsers partially implement mediaDevices.
    // We can't just assign an object with getUserMedia as it would overwrite existing properties.
    // Here, we will just add the getUserMedia property if it's missing.
    if (navigator.mediaDevices.getUserMedia === undefined) {
      navigator.mediaDevices.getUserMedia = function (constraints) {
        // First get ahold of the legacy getUserMedia, if present
        var getUserMedia = navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia;

        // Some browsers just don't implement it - return a rejected promise with an error
        // to keep a consistent interface
        if (!getUserMedia) {
          return Promise.reject(new Error("getUserMedia is not implemented in this browser"));
        }

        // Otherwise, wrap the call to the old navigator.getUserMedia with a Promise
        return new Promise(function (resolve, reject) {
          getUserMedia.call(navigator, constraints, resolve, reject);
        });
      };
    }

    app.canvasOuter = document.querySelector(".canvas-outer");
    app.canvasBox = document.querySelector(".canvas-box");
    app.canvasElement = document.querySelector(".canvas-element");
    app.canvasCtx = app.canvasElement.getContext("2d");

    app.setupAudioAnalyser();
  },

  setupAudioAnalyser: function () {
    // Set audio context (window is needed otherwise Safari explodes)
    app.audioCtx = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: app.config.sampleRate,
    });

    app.analyser = app.audioCtx.createAnalyser();

    // Request access to microphone
    if (navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => {
          app.source = app.audioCtx.createMediaStreamSource(stream);
          app.source.connect(app.analyser);
          app.removeClickMessage();
          app.start();
        })
        .catch(function (err) {
          console.log("The following getUserMedia error occured: " + err);
        });
    } else {
      console.log("Sorry, getUserMedia is not supported by your browser.");
    }

    app.clearCanvas();
    app.updateConfigVars();
    app.resizeCanvas();
  },

  start: function () {
    app.startAnimating();
    window.addEventListener(
      "resize",
      function () {
        clearTimeout(app.resizeCanvasTimeout);
        app.resizeCanvasTimeout = setTimeout(app.resizeCanvas, 100);
      },
      false
    );
  },

  updateConfigVars: function () {
    app.analyser.minDecibels = app.config.minDecibels;
    app.analyser.maxDecibels = app.config.maxDecibels;
    app.analyser.smoothingTimeConstant = app.config.smoothingTimeConstant;
    app.analyser.fftSize = app.config.fftSize;
    app.spectrum = new Uint8Array(app.analyser.frequencyBinCount);
    app.blockWidth = app.getBlockWidth();
    app.blockHeight = app.getBlockHeight();
  },

  getBlockWidth: function () {
    return app.canvasElement.width / app.config.duration / app.fps;
  },

  getBlockHeight: function () {
    return app.canvasElement.height / app.analyser.frequencyBinCount;
  },

  removeClickMessage: function () {
    document.querySelector(".click-init-message").remove();
  },

  setupControls: function () {
    controlsDisplay = document.querySelector(".controls");

    btnSync = document.querySelector(".controls-sync__btn");
    btnSync.addEventListener("click", function () {
      app.sync();
    });

    btnToggleMenu = document.querySelector(".controls-toggle__btn");
    btnToggleMenu.addEventListener("click", function () {
      if (app.controlsVisible) {
        controlsDisplay.classList.add("controls--hidden");
        app.controlsVisible = false;
        btnToggleMenu.innerHTML = "Options";
      } else {
        controlsDisplay.classList.remove("controls--hidden");
        app.controlsVisible = true;
        btnToggleMenu.innerHTML = "Close (X)";
      }
    });

    app.controls.forEach((control) => {
      let btnDecrement = document.createElement("button");
      btnDecrement.setAttribute("class", "btn");
      btnDecrement.setAttribute("data-btn-decrement" + control.key + "", "true");

      if (app.config[control.key] == control.min) {
        btnDecrement.classList.add("btn--inactive");
      }

      btnDecrement.addEventListener("click", function (event) {
        app.adjustConfigValue("decrement", event, control);
      });
      btnDecrement.innerHTML = '<img src="assets/images/arrow-left.svg" />';

      let btnIncrement = document.createElement("button");
      btnIncrement.setAttribute("class", "btn");
      btnIncrement.setAttribute("data-btn-increment" + control.key + "", "true");

      if (app.config[control.key] == control.max) {
        btnIncrement.classList.add("btn--inactive");
      }

      btnIncrement.addEventListener("click", function (event) {
        app.adjustConfigValue("increment", event, control);
      });
      btnIncrement.innerHTML = '<img src="assets/images/arrow-right.svg" />';

      let valueDisplay = document.createElement("div");
      valueDisplay.setAttribute("class", "value");
      valueDisplay.innerHTML = app.config[control.key];

      let inputsDisplay = document.createElement("div");
      inputsDisplay.setAttribute("class", "inputs");
      inputsDisplay.appendChild(btnDecrement);
      inputsDisplay.appendChild(valueDisplay);
      inputsDisplay.appendChild(btnIncrement);

      let labelDisplay = document.createElement("div");
      labelDisplay.setAttribute("class", "label");
      labelDisplay.innerHTML = control.label;

      let controlDisplay = document.createElement("div");
      controlDisplay.setAttribute("class", "control");
      controlDisplay.appendChild(labelDisplay);
      controlDisplay.appendChild(inputsDisplay);

      controlsDisplay.appendChild(controlDisplay);
    });
  },

  adjustConfigValue(direction, event, control) {
    let currentValue = app.config[control.key];
    let nextValue;

    if (control.validValues) {
      let currentValueIndex = 0;
      for (let i = 0; i < control.validValues.length; i++) {
        if (currentValue === control.validValues[i]) {
          currentValueIndex = i;
        }
      }
      switch (direction) {
        case "decrement":
          if (currentValueIndex > 0) {
            nextValue = control.validValues[currentValueIndex - 1];
          }
          break;
        case "increment":
          if (currentValueIndex < control.validValues.length - 1) {
            nextValue = control.validValues[currentValueIndex + 1];
          }
        default:
          break;
      }
    } else {
      switch (direction) {
        case "decrement":
          nextValue = currentValue - control.step;
          break;
        case "increment":
          nextValue = currentValue + control.step;
        default:
          break;
      }
    }

    switch (direction) {
      case "decrement":
        if (nextValue >= control.min) {
          currentValue = parseFloat(nextValue.toFixed(control.precision));
        }
        if (nextValue <= control.min) {
          document.querySelector("[data-btn-decrement" + control.key + "]").classList.add("btn--inactive");
        }
        document.querySelector("[data-btn-increment" + control.key + "]").classList.remove("btn--inactive");
        break;
      case "increment":
        if (nextValue <= control.max) {
          currentValue = parseFloat(nextValue.toFixed(control.precision));
        }
        if (nextValue >= control.max) {
          document.querySelector("[data-btn-increment" + control.key + "]").classList.add("btn--inactive");
        }
        document.querySelector("[data-btn-decrement" + control.key + "]").classList.remove("btn--inactive");
      default:
        break;
    }

    if (control.key == "minDecibels" && currentValue >= app.config.maxDecibels) {
      currentValue = app.config.maxDecibels - control.step;
    } else if (control.key == "maxDecibels" && currentValue <= app.config.minDecibels) {
      currentValue = app.config.minDecibels + control.step;
    } else {
      app.config[control.key] = currentValue;
      let inputs = event.currentTarget.parentNode;
      let value = inputs.querySelector(".value");
      value.innerHTML = currentValue;
    }

    app.updateConfigVars();
  },

  resizeCanvas: function () {
    const pixelRatio = window.devicePixelRatio || 1;
    const outerWidth = app.canvasOuter.offsetWidth;
    const outerHeight = app.canvasOuter.offsetHeight;

    let boxWidth = 0;
    let boxHeight = 0;

    if (outerHeight > outerWidth * 1.25) {
      boxWidth = outerWidth;
      boxHeight = outerWidth * 1.25;
    } else {
      boxWidth = outerHeight * 0.8;
      boxHeight = outerHeight;
    }

    boxWidth = Math.floor(boxWidth);
    boxHeight = Math.floor(boxHeight);

    app.canvasBox.style.width = boxWidth + "px";
    app.canvasBox.style.height = boxHeight + "px";

    app.canvasElement.width = boxWidth * pixelRatio;
    app.canvasElement.height = boxHeight * pixelRatio;

    app.blockWidth = app.getBlockWidth();
    app.blockHeight = app.getBlockHeight();
  },

  clearCanvas: function () {
    app.canvasCtx.fillStyle = "rgb(0, 0, 0)";
    app.canvasCtx.fillRect(0, 0, app.canvasElement.width, app.canvasElement.height);
  },

  sync: function () {
    app.clearCanvas();
    app.xPosition = 0;
  },

  startAnimating: function () {
    app.fpsInterval = 1000 / app.fps;
    app.then = performance.now();
    app.startTime = app.then;

    app.playing = true;

    app.animate();
  },

  animate: function () {
    if (!app.playing) {
      return;
    }

    // request another frame
    requestAnimationFrame(app.animate);

    // calc elapsed time since last loop
    app.now = performance.now();
    app.elapsed = app.now - app.then;

    // if enough time has elapsed, draw the next frame
    if (app.elapsed > app.fpsInterval) {
      // Get ready for next frame by setting then=now, but also adjust for your
      // specified fpsInterval not being a multiple of RAF's interval (16.7ms)
      app.then = app.now - (app.elapsed % app.fpsInterval);

      // draw
      app.drawFrame();

      // update FPS display
      if (app.fpsDebug) {
        app.displayFps();
      }
    }
  },

  drawFrame: function () {
    // Fill spectrum with data
    app.analyser.getByteFrequencyData(app.spectrum);

    // Erase x position
    //app.canvasCtx.fillStyle = "rgb(0,0,0)";
    //app.canvasCtx.fillRect(app.xPosition, 0, app.blockWidth, app.canvasElement.height);

    for (var i = 0; i < app.analyser.frequencyBinCount; i++) {
      const volume = app.spectrum[i];
      const fillColor = volume > 0 ? app.reRange(volume, 0, 255, app.config.midBright, app.config.peakBright) : 0;
      const yPosition = app.canvasElement.height - app.blockHeight - i * app.blockHeight;

      // Draw x, y position
      app.canvasCtx.fillStyle = "rgba(" + fillColor + ", " + fillColor + ", " + fillColor + ", " + app.config.fillOpacity + ")";
      app.canvasCtx.fillRect(app.xPosition, yPosition, app.blockWidth, app.blockHeight);
    }

    // Increment x, if x is greater than canvas width, reset it to 0
    app.xPosition += app.blockWidth;
    if (app.xPosition > app.canvasElement.width) {
      app.xPosition = 0;
    }
  },

  displayFps: function () {
    const sinceStart = app.now - app.startTime;
    const currentFps = Math.round((1000 / (sinceStart / app.frameCount)) * 100) / 100;
    app.frameCount++;
    console.log("Elapsed time= " + Math.round((sinceStart / 1000) * 100) / 100 + " secs @ " + currentFps + " fps.");
  },

  reRange: function (n, from_min, from_max, to_min, to_max, constrain_within_range) {
    const newval = ((n - from_min) / (from_max - from_min)) * (to_max - to_min) + to_min;
    if (!constrain_within_range) {
      return newval;
    }
    if (to_min < to_max) {
      return app.constrain(newval, to_min, to_max);
    } else {
      return app.constrain(newval, to_max, to_min);
    }
  },

  constrain: function (n, low, high) {
    return Math.max(Math.min(n, high), low);
  },

  debounce: function (fn) {
    /**
     * Debounce functions for better performance
     * (c) 2021 Chris Ferdinandi, MIT License, https://gomakethings.com
     */

    // Setup a timer
    let timeout;

    // Return a function to run debounced
    return function () {
      // Setup the arguments
      let context = this;
      let args = arguments;

      // If there's a timer, cancel it
      if (timeout) {
        window.cancelAnimationFrame(timeout);
      }

      // Setup the new requestAnimationFrame()
      timeout = window.requestAnimationFrame(function () {
        fn.apply(context, args);
      });
    };
  },
};
