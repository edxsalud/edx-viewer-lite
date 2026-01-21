/**
 * ViewportManager - Module for Cornerstone viewport and image display
 * Part of EDX Viewer Lite
 */
var ViewportManager = (function () {
    'use strict';

    /**
     * Creates a new ViewportManager instance
     * @param {DicomViewer} viewer - Reference to the main viewer instance
     */
    function ViewportManager(viewer) {
        this.viewer = viewer;
        this.element = null;
        this.viewportInitialized = false;
        this.invalidImageIndices = new Set();
    }

    /**
     * Sets up the Cornerstone viewport element
     */
    ViewportManager.prototype.setupViewport = function () {
        var self = this;
        var container = document.getElementById('dicom-viewport');

        // Hide instructions zone
        var instructionsZone = document.getElementById('instructions-zone');
        if (instructionsZone) instructionsZone.classList.add('hidden');

        // Remove old element if exists
        if (this.element) {
            try {
                cornerstone.disable(this.element);
            } catch (e) { }
        }

        // Create fresh element for Cornerstone
        container.innerHTML = '<div id="cornerstone-element" style="width: 100%; height: 100%;"></div>';
        this.element = document.getElementById('cornerstone-element');
        this.viewer.element = this.element;

        // Enable Cornerstone on the new element
        cornerstone.enable(this.element);
        this.viewportInitialized = true;
        this.viewer.viewportInitialized = true;

        // Re-setup mouse events on new element
        this.viewer.ui.setupViewportEvents();

        // Listen for image rendered event to redraw measurements
        var measureTool = this.viewer.measurement;
        this.element.addEventListener('cornerstoneimagerendered', function () {
            if (measureTool) measureTool.drawMeasurements();
        });
    };

    /**
     * Loads the first valid image from the current series
     */
    ViewportManager.prototype.loadFirstValidImage = async function () {
        for (var i = 0; i < this.viewer.imageIds.length; i++) {
            if (this.invalidImageIndices.has(i)) continue;

            var success = await this.tryLoadImage(i);
            if (success) {
                this.viewer.currentImageIndex = i;
                return;
            }
        }

        this.viewportInitialized = false;
        this.viewer.viewportInitialized = false;
        await this.handleNonImageDicom(0);
    };

    /**
     * Tries to load an image at a specific index
     * @param {number} index - Image index to load
     * @returns {boolean} True if successful
     */
    ViewportManager.prototype.tryLoadImage = async function (index) {
        try {
            if (!this.viewportInitialized) {
                this.setupViewport();
            }

            var imageId = this.viewer.imageIds[index];
            var image = await cornerstone.loadImage(imageId);
            cornerstone.displayImage(this.element, image);
            this.viewer.ui.updateMetadata(image);
            return true;
        } catch (error) {
            this.invalidImageIndices.add(index);
            return false;
        }
    };

    /**
     * Loads an image at a specific index with navigation direction
     * @param {number} index - Image index
     * @param {number} direction - Navigation direction (1 or -1)
     */
    ViewportManager.prototype.loadImage = async function (index, direction) {
        direction = direction || 1;

        if (!this.viewer.imageIds.length || index < 0 || index >= this.viewer.imageIds.length) return;

        if (this.invalidImageIndices && this.invalidImageIndices.has(index)) {
            var nextIndex = index + direction;
            if (nextIndex >= 0 && nextIndex < this.viewer.imageIds.length) {
                return this.loadImage(nextIndex, direction);
            }
            return;
        }

        this.viewer.currentImageIndex = index;
        var imageId = this.viewer.imageIds[index];

        try {
            if (!this.viewportInitialized) {
                this.setupViewport();
            }

            var image = await cornerstone.loadImage(imageId);
            cornerstone.displayImage(this.element, image);
            this.viewer.ui.updateMetadata(image);
            this.viewer.ui.updateNavigation();

        } catch (error) {
            if (!this.invalidImageIndices) {
                this.invalidImageIndices = new Set();
            }
            this.invalidImageIndices.add(index);

            var next = index + direction;
            if (next >= 0 && next < this.viewer.imageIds.length) {
                return this.loadImage(next, direction);
            }

            await this.handleNonImageDicom(index);
        }
    };

    /**
     * Loads a Structured Report (SR) series
     * @param {Object} series - Series object
     */
    ViewportManager.prototype.loadStructuredReport = async function (series) {
        try {
            if (this.element) {
                try {
                    cornerstone.disable(this.element);
                } catch (e) { }
                this.element = null;
                this.viewer.element = null;
            }

            var viewport = document.getElementById('dicom-viewport');
            var file = series.images[0].file;
            var arrayBuffer = await file.arrayBuffer();
            var srContent = this.parseSRContent(arrayBuffer);

            viewport.innerHTML =
                '<div class="sr-viewer">' +
                '<div class="sr-header">' +
                '<h3><i class="fas fa-file-medical-alt"></i> Reporte Estructurado (SR)</h3>' +
                '</div>' +
                '<div class="sr-content">' + srContent + '</div>' +
                '</div>';

            this.viewer.imageIds = [];
            document.getElementById('image-counter').textContent = 'Reporte';
            this.viewer.ui.updateNavigation();
            this.updateSRMetadata(arrayBuffer);

        } catch (error) {
            console.error('Error loading SR:', error);
            var vp = document.getElementById('dicom-viewport');
            vp.innerHTML = '<div class="sr-viewer"><p style="color: #ef4444;">Error al cargar el reporte: ' + error.message + '</p></div>';
        }
    };

    /**
     * Parses SR content from array buffer
     * @param {ArrayBuffer} arrayBuffer - DICOM file buffer
     * @returns {string} HTML content
     */
    ViewportManager.prototype.parseSRContent = function (arrayBuffer) {
        try {
            var dataSet = dicomParser.parseDicom(new Uint8Array(arrayBuffer));
            var texts = [];

            for (var tag in dataSet.elements) {
                var element = dataSet.elements[tag];
                if (element.length && element.length < 10000) {
                    try {
                        var value = dataSet.string(tag);
                        if (value && value.length > 2 && /[a-zA-Z]/.test(value)) {
                            if (!value.match(/^[0-9.]+$/) && !value.match(/^[A-Z0-9]{64}$/)) {
                                texts.push(value);
                            }
                        }
                    } catch (e) { }
                }
            }

            if (texts.length > 0) {
                return texts.map(function (t) { return '<p>' + t + '</p>'; }).join('');
            }
            return '<p style="color: var(--text-secondary);">Este reporte no contiene texto legible directamente.</p>';
        } catch (e) {
            return '<p style="color: #ef4444;">No se pudo parsear el contenido del SR: ' + e.message + '</p>';
        }
    };

    /**
     * Handles non-image DICOM files
     * @param {number} index - File index
     */
    ViewportManager.prototype.handleNonImageDicom = async function (index) {
        try {
            this.viewportInitialized = false;
            this.viewer.viewportInitialized = false;

            if (this.element) {
                try {
                    cornerstone.disable(this.element);
                } catch (e) { }
                this.element = null;
                this.viewer.element = null;
            }

            var file = this.viewer.currentSeries.images[index].file;
            var arrayBuffer = await file.arrayBuffer();
            var srContent = this.parseSRContent(arrayBuffer);

            var viewport = document.getElementById('dicom-viewport');
            viewport.innerHTML =
                '<div class="sr-viewer">' +
                '<div class="sr-header">' +
                '<h3><i class="fas fa-file-medical"></i> Documento DICOM (sin imagen)</h3>' +
                '</div>' +
                '<div class="sr-content">' + srContent + '</div>' +
                '</div>';

            this.updateSRMetadata(arrayBuffer);
            this.viewer.ui.updateNavigation();

        } catch (e) {
            console.error('Error handling non-image DICOM:', e);
        }
    };

    /**
     * Updates SR metadata display
     * @param {ArrayBuffer} arrayBuffer - DICOM file buffer
     */
    ViewportManager.prototype.updateSRMetadata = function (arrayBuffer) {
        try {
            var dataSet = dicomParser.parseDicom(new Uint8Array(arrayBuffer));

            var patientName = dataSet.string('x00100010') || 'Desconocido';
            var patientId = dataSet.string('x00100020') || 'N/A';
            var patientBirth = dataSet.string('x00100030') || 'N/A';
            var patientSex = dataSet.string('x00100040') || 'N/A';
            var studyDate = dataSet.string('x00080020') || 'N/A';
            var studyDesc = dataSet.string('x00081030') || 'N/A';
            var modality = dataSet.string('x00080060') || 'SR';
            var institution = dataSet.string('x00080080') || 'N/A';

            document.getElementById('patient-info').innerHTML =
                '<div class="info-row"><span class="info-label">Nombre</span><span class="info-value">' + patientName + '</span></div>' +
                '<div class="info-row"><span class="info-label">ID</span><span class="info-value">' + patientId + '</span></div>' +
                '<div class="info-row"><span class="info-label">Nacimiento</span><span class="info-value">' + this.viewer.ui.formatDate(patientBirth) + '</span></div>' +
                '<div class="info-row"><span class="info-label">Sexo</span><span class="info-value">' + patientSex + '</span></div>';

            document.getElementById('study-info').innerHTML =
                '<div class="info-row"><span class="info-label">Fecha</span><span class="info-value">' + this.viewer.ui.formatDate(studyDate) + '</span></div>' +
                '<div class="info-row"><span class="info-label">Descripción</span><span class="info-value">' + studyDesc + '</span></div>' +
                '<div class="info-row"><span class="info-label">Modalidad</span><span class="info-value">' + modality + '</span></div>' +
                '<div class="info-row"><span class="info-label">Institución</span><span class="info-value">' + institution + '</span></div>';

            document.getElementById('image-info').innerHTML =
                '<div class="info-row"><span class="info-label">Tipo</span><span class="info-value">Reporte Estructurado</span></div>' +
                '<div class="info-row"><span class="info-label">Modalidad</span><span class="info-value">' + modality + '</span></div>';
        } catch (e) {
            console.error('Error parsing SR metadata:', e);
        }
    };

    /**
     * Navigate to next/previous image
     * @param {number} direction - Direction (-1 or 1)
     */
    ViewportManager.prototype.navigate = function (direction) {
        if (!this.viewer.imageIds.length) return;

        var newIndex = this.viewer.currentImageIndex + direction;
        if (newIndex >= 0 && newIndex < this.viewer.imageIds.length) {
            this.loadImage(newIndex, direction);
        }
    };

    /**
     * Resets the viewport to default state
     */
    ViewportManager.prototype.resetView = function () {
        if (!this.element) return;
        cornerstone.reset(this.element);
        var viewport = cornerstone.getViewport(this.element);
        if (viewport) {
            var wcEl = document.getElementById('wc-value');
            var wwEl = document.getElementById('ww-value');
            if (wcEl) wcEl.textContent = viewport.voi.windowCenter.toFixed(0);
            if (wwEl) wwEl.textContent = viewport.voi.windowWidth.toFixed(0);
        }
        if (this.viewer.measurement) {
            this.viewer.measurement.clearMeasurements();
        }
    };

    return ViewportManager;
})();
