document.addEventListener("DOMContentLoaded", function () {
	// Create controls
	app.setupControls();

	// Add click to init audio setup
	document.body.addEventListener("click", app.init);
});

const app = {
	config: {
		/*
		sampleRate
		Is it ok to set sampleRate? Might be set by system only.
		*/
		sampleRate: 44100,
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
		smoothingTimeConstant: 0,
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
		minDecibels: -90,
		maxDecibels: -30,

		/*
		UI
		*/
		peakBright: 255,
		midBright: 60,
	},

	resizeCanvasTimeout: null,
	controlsVisible: false,

	controls: [
		{
			key: "fftSize",
			label: "FFT Size",
			min: 32,
			max: 32768,
			validValues: [
				32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768,
			],
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
	],

	audioCtx: null,
	analyser: null,
	source: null,
	spectrum: null,

	canvasWrap: null,
	canvas: null,
	canvasCtx: null,
	blockWidth: 1,
	blockHeight: 1,
	xPosition: 0,

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
				var getUserMedia =
					navigator.webkitGetUserMedia ||
					navigator.mozGetUserMedia ||
					navigator.msGetUserMedia;

				// Some browsers just don't implement it - return a rejected promise with an error
				// to keep a consistent interface
				if (!getUserMedia) {
					return Promise.reject(
						new Error("getUserMedia is not implemented in this browser")
					);
				}

				// Otherwise, wrap the call to the old navigator.getUserMedia with a Promise
				return new Promise(function (resolve, reject) {
					getUserMedia.call(navigator, constraints, resolve, reject);
				});
			};
		}

		app.canvasWrap = document.querySelector(".spectrogram");
		app.canvas = document.querySelector(".canvas");
		app.canvasCtx = app.canvas.getContext("2d");

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
		app.resizeCanvas();
		app.updateConfigVars();
	},

	start: function () {
		app.draw();
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
		app.blockWidth = 1;
		app.blockHeight = Math.ceil(
			app.canvas.height / app.analyser.frequencyBinCount
		);
	},

	removeClickMessage: function () {
		document.querySelector(".click-init-message").remove();
	},

	setupControls: function () {
		controlsArea = document.querySelector(".controls");

		btnToggleMenu = document.querySelector(".controls-toggle__btn");
		btnToggleMenu.addEventListener("click", function () {
			if (app.controlsVisible) {
				controlsArea.setAttribute("style", "display: none;");
				app.controlsVisible = false;
				btnToggleMenu.innerHTML = "menu";
			} else {
				controlsArea.removeAttribute("style");
				app.controlsVisible = true;
				btnToggleMenu.innerHTML = "close";
			}
		});

		app.controls.forEach((control) => {
			let btnDecrement = document.createElement("button");
			btnDecrement.setAttribute("class", "btn");
			btnDecrement.setAttribute(
				"data-btn-decrement" + control.key + "",
				"true"
			);

			if (app.config[control.key] == control.min) {
				btnDecrement.classList.add("btn--inactive");
			}

			btnDecrement.addEventListener("click", function (event) {
				app.adjustConfigValue("decrement", event, control);
			});
			btnDecrement.innerHTML = '<img src="assets/images/arrow-left.svg" />';

			let btnIncrement = document.createElement("button");
			btnIncrement.setAttribute("class", "btn");
			btnIncrement.setAttribute(
				"data-btn-increment" + control.key + "",
				"true"
			);

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

			controlsArea.appendChild(controlDisplay);
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
					document
						.querySelector("[data-btn-decrement" + control.key + "]")
						.classList.add("btn--inactive");
				}
				document
					.querySelector("[data-btn-increment" + control.key + "]")
					.classList.remove("btn--inactive");
				break;
			case "increment":
				if (nextValue <= control.max) {
					currentValue = parseFloat(nextValue.toFixed(control.precision));
				}
				if (nextValue >= control.max) {
					document
						.querySelector("[data-btn-increment" + control.key + "]")
						.classList.add("btn--inactive");
				}
				document
					.querySelector("[data-btn-decrement" + control.key + "]")
					.classList.remove("btn--inactive");
			default:
				break;
		}

		if (
			control.key == "minDecibels" &&
			currentValue >= app.config.maxDecibels
		) {
			currentValue = app.config.maxDecibels - control.step;
		} else if (
			control.key == "maxDecibels" &&
			currentValue <= app.config.minDecibels
		) {
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
		const w = app.canvasWrap.offsetWidth;
		const h = app.canvasWrap.offsetHeight;
		app.canvas.width = w * pixelRatio;
		app.canvas.height = h * pixelRatio;
	},

	clearCanvas: function () {
		app.canvasCtx.fillStyle = "rgb(0, 0, 0)";
		app.canvasCtx.fillRect(0, 0, app.canvas.width, app.canvas.height);
	},

	draw: function () {
		// Fill spectrum with data
		app.analyser.getByteFrequencyData(app.spectrum);

		let amp = 0;
		let yPosition = 0;

		for (var i = 0; i < app.analyser.frequencyBinCount; i++) {
			// let frequency = (i * audioCtx.sampleRate) / fftSize;
			fillColor =
				app.spectrum[i] > 0
					? app.remap(
							app.spectrum[i],
							0,
							255,
							app.config.midBright,
							app.config.peakBright
					  )
					: 0;
			yPosition = Math.round(
				app.remap(i, 0, app.analyser.frequencyBinCount, app.canvas.height, 0)
			);
			app.canvasCtx.fillStyle = "rgb(0,0,0)";
			app.canvasCtx.fillRect(
				app.xPosition,
				yPosition,
				app.blockWidth,
				app.blockHeight
			);
			app.canvasCtx.fillStyle =
				"rgb(" + fillColor + ", " + fillColor + ", " + fillColor + ")";
			app.canvasCtx.fillRect(
				app.xPosition,
				yPosition,
				app.blockWidth,
				app.blockHeight
			);
		}

		// increment x, if x is greater than canvas width, reset it to 0
		app.xPosition += 1;
		if (app.xPosition > app.canvas.width) {
			app.xPosition = 0;
		}

		requestAnimationFrame(app.draw);
	},

	remap: function (
		n,
		from_min,
		from_max,
		to_min,
		to_max,
		constrain_within_range
	) {
		const newval =
			((n - from_min) / (from_max - from_min)) * (to_max - to_min) + to_min;
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
