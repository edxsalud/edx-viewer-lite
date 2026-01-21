/**
 * UIController - Module for UI events and display management
 * Part of EDX Viewer Lite
 */
var UIController = (function () {
    'use strict';

    /**
     * Creates a new UIController instance
     * @param {DicomViewer} viewer - Reference to the main viewer instance
     */
    function UIController(viewer) {
        this.viewer = viewer;
        this.activeTool = 'wwwc';
        this.wheelAccumulator = 0;
        this.isWheelScrolling = false;
        this.wheelScrollTimeout = null;
        this.stackScrollAccumulator = 0;
    }

    /**
     * Sets up all event listeners
     */
    UIController.prototype.setupEventListeners = function () {
        var self = this;

        // Tool buttons
        document.getElementById('tool-pan').onclick = function () { self.setTool('pan'); };
        document.getElementById('tool-zoom').onclick = function () { self.setTool('zoom'); };
        document.getElementById('tool-wwwc').onclick = function () { self.setTool('wwwc'); };
        document.getElementById('tool-length').onclick = function () { self.setTool('length'); };
        document.getElementById('tool-stackscroll').onclick = function () { self.setTool('stackscroll'); };
        document.getElementById('tool-reset').onclick = function () { self.viewer.viewport.resetView(); };

        // About modal
        document.getElementById('btn-about').onclick = function () { self.openAboutModal(); };

        document.getElementById('about-modal').onclick = function (e) {
            if (e.target.id === 'about-modal') self.closeAboutModal();
        };

        // Download modal
        document.getElementById('tool-download').onclick = function () {
            self.viewer.exporter.openDownloadModal();
        };

        document.getElementById('download-modal').onclick = function (e) {
            if (e.target.id === 'download-modal') self.viewer.exporter.closeDownloadModal();
        };

        // Download input changes
        ['download-width', 'download-height', 'download-format', 'download-annotations', 'download-warning'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.addEventListener('change', function () {
                self.viewer.exporter.updateDownloadPreview();
            });
        });

        // Navigation
        document.getElementById('prev-image').onclick = function () { self.viewer.viewport.navigate(-1); };
        document.getElementById('next-image').onclick = function () { self.viewer.viewport.navigate(1); };

        // Keyboard navigation
        document.addEventListener('keydown', function (e) {
            if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') self.viewer.viewport.navigate(-1);
            if (e.key === 'ArrowDown' || e.key === 'ArrowRight') self.viewer.viewport.navigate(1);
            if (e.key === 'Escape') {
                self.closeAboutModal();
                self.viewer.exporter.closeDownloadModal();
            }
        });
    };

    /**
     * Sets up viewport mouse/wheel events
     */
    UIController.prototype.setupViewportEvents = function () {
        var self = this;
        var container = document.getElementById('dicom-viewport');

        var isDragging = false;
        var lastPos = { x: 0, y: 0 };

        container.addEventListener('mousedown', function (e) {
            if (!self.viewer.element) return;

            // Handle measurement tool
            if (self.viewer.measurement && self.viewer.measurement.handleMouseDown(e)) {
                return;
            }

            isDragging = true;
            lastPos = { x: e.clientX, y: e.clientY };
        });

        container.addEventListener('mousemove', function (e) {
            if (!self.viewer.element) return;

            // Handle measurement drawing
            if (self.viewer.measurement && self.viewer.measurement.handleMouseMove(e)) {
                return;
            }

            if (!isDragging) return;

            var dx = e.clientX - lastPos.x;
            var dy = e.clientY - lastPos.y;
            lastPos = { x: e.clientX, y: e.clientY };

            var viewport = cornerstone.getViewport(self.viewer.element);
            if (!viewport) return;

            if (self.activeTool === 'stackscroll') {
                if (!self.stackScrollAccumulator) self.stackScrollAccumulator = 0;
                self.stackScrollAccumulator += dy;

                var threshold = 30;
                if (Math.abs(self.stackScrollAccumulator) >= threshold) {
                    var direction = self.stackScrollAccumulator > 0 ? 1 : -1;
                    self.viewer.viewport.navigate(direction);
                    self.stackScrollAccumulator = 0;
                }
            } else if (self.activeTool === 'wwwc') {
                viewport.voi.windowWidth += dx * 2;
                viewport.voi.windowCenter += dy;
                cornerstone.setViewport(self.viewer.element, viewport);

                var wcEl = document.getElementById('wc-value');
                var wwEl = document.getElementById('ww-value');
                if (wcEl) wcEl.textContent = viewport.voi.windowCenter.toFixed(0);
                if (wwEl) wwEl.textContent = viewport.voi.windowWidth.toFixed(0);
            } else if (self.activeTool === 'pan') {
                viewport.translation.x += dx;
                viewport.translation.y += dy;
                cornerstone.setViewport(self.viewer.element, viewport);
            } else if (self.activeTool === 'zoom') {
                viewport.scale += dy * 0.01;
                viewport.scale = Math.max(0.1, Math.min(10, viewport.scale));
                cornerstone.setViewport(self.viewer.element, viewport);
            }
        });

        container.addEventListener('mouseup', function (e) {
            // Finish measurement
            if (self.viewer.measurement && self.viewer.measurement.handleMouseUp(e)) {
                isDragging = false;
                return;
            }
            isDragging = false;
            self.stackScrollAccumulator = 0;
        });

        container.addEventListener('mouseleave', function () {
            isDragging = false;
            self.stackScrollAccumulator = 0;
        });

        // Mouse wheel/trackpad for controlled image scrolling
        var scrollDelay = 30;
        var trackpadThreshold = 150;

        container.addEventListener('wheel', function (e) {
            if (!self.viewer.imageIds.length) return;
            e.preventDefault();

            if (self.isWheelScrolling) return;

            self.wheelAccumulator += e.deltaY;

            if (Math.abs(self.wheelAccumulator) >= trackpadThreshold) {
                var direction = self.wheelAccumulator > 0 ? 1 : -1;
                self.viewer.viewport.navigate(direction);

                self.wheelAccumulator = 0;
                self.isWheelScrolling = true;
                clearTimeout(self.wheelScrollTimeout);
                self.wheelScrollTimeout = setTimeout(function () {
                    self.isWheelScrolling = false;
                    self.wheelAccumulator = 0;
                }, scrollDelay);
            }
        }, { passive: false });
    };

    /**
     * Sets the active tool
     * @param {string} tool - Tool name
     */
    UIController.prototype.setTool = function (tool) {
        this.activeTool = tool;
        this.viewer.activeTool = tool;
        document.querySelectorAll('.tool-btn').forEach(function (btn) {
            btn.classList.remove('active');
        });
        document.getElementById('tool-' + tool).classList.add('active');
    };

    /**
     * Renders the studies list in the sidebar
     */
    UIController.prototype.renderStudiesList = function () {
        var self = this;
        var container = document.getElementById('studies-list');
        container.innerHTML = '';

        this.viewer.studies.forEach(function (study, studyIdx) {
            var studyEl = document.createElement('div');
            studyEl.classList.add('study-item');

            var seriesCount = Object.keys(study.series).length;

            studyEl.innerHTML =
                '<div class="study-header" onclick="viewer.ui.toggleStudy(' + studyIdx + ')">' +
                '<div class="study-icon"><i class="fas fa-folder"></i></div>' +
                '<div class="study-info">' +
                '<div class="study-description">' + (study.description || 'Estudio') + '</div>' +
                '<div class="study-details">' + seriesCount + ' series</div>' +
                '</div>' +
                '</div>' +
                '<div class="series-list" id="series-' + studyIdx + '"></div>';

            container.appendChild(studyEl);

            // Render series
            var seriesList = document.getElementById('series-' + studyIdx);
            for (var seriesId in study.series) {
                var series = study.series[seriesId];
                var seriesEl = document.createElement('div');
                seriesEl.classList.add('series-item');
                seriesEl.dataset.studyIdx = studyIdx;
                seriesEl.dataset.seriesId = seriesId;

                seriesEl.innerHTML =
                    '<span class="series-icon"><i class="fas fa-images"></i></span>' +
                    '<span class="series-info">' +
                    '<span class="series-name">Serie ' + (Object.keys(study.series).indexOf(seriesId) + 1) +
                    (series.description ? ' - ' + series.description : '') + '</span>' +
                    '<span class="series-count">(' + series.images.length + ')</span>' +
                    '</span>';

                seriesEl.onclick = function () { self.selectSeries(this); };
                seriesList.appendChild(seriesEl);
            }
        });
    };

    /**
     * Toggles a study's expanded state
     * @param {number} idx - Study index
     */
    UIController.prototype.toggleStudy = function (idx) {
        var seriesList = document.getElementById('series-' + idx);
        if (seriesList) {
            seriesList.classList.toggle('expanded');
        }
    };

    /**
     * Selects a series from the sidebar
     * @param {HTMLElement} element - Series element
     */
    UIController.prototype.selectSeries = async function (element) {
        var studyIdx = parseInt(element.dataset.studyIdx);
        var seriesId = element.dataset.seriesId;

        // Remove active from all series
        document.querySelectorAll('.series-item').forEach(function (s) {
            s.classList.remove('active');
        });
        element.classList.add('active');

        await this.viewer.selectSeriesDirectly(studyIdx, seriesId);
    };

    /**
     * Updates the navigation UI
     */
    UIController.prototype.updateNavigation = function () {
        var total = this.viewer.imageIds.length;
        var stackScrollBtn = document.getElementById('tool-stackscroll');
        var imageScrollbar = document.getElementById('image-scrollbar');
        var scrollbarThumb = document.getElementById('scrollbar-thumb');

        if (total === 0) {
            document.getElementById('image-counter').textContent = 'Reporte';
            document.getElementById('prev-image').disabled = true;
            document.getElementById('next-image').disabled = true;
            if (stackScrollBtn) {
                stackScrollBtn.disabled = true;
                stackScrollBtn.title = 'Scroll de Imágenes (no disponible)';
            }
            if (imageScrollbar) imageScrollbar.classList.add('hidden');
        } else if (total === 1) {
            document.getElementById('image-counter').textContent = (this.viewer.currentImageIndex + 1) + ' / ' + total;
            document.getElementById('prev-image').disabled = true;
            document.getElementById('next-image').disabled = true;
            if (stackScrollBtn) {
                stackScrollBtn.disabled = true;
                stackScrollBtn.title = 'Scroll de Imágenes (solo 1 imagen)';
            }
            if (imageScrollbar) imageScrollbar.classList.add('hidden');
        } else {
            document.getElementById('image-counter').textContent = (this.viewer.currentImageIndex + 1) + ' / ' + total;
            document.getElementById('prev-image').disabled = this.viewer.currentImageIndex <= 0;
            document.getElementById('next-image').disabled = this.viewer.currentImageIndex >= total - 1;
            if (stackScrollBtn) {
                stackScrollBtn.disabled = false;
                stackScrollBtn.title = 'Scroll de Imágenes - Navega con click sostenido';
            }

            if (imageScrollbar && scrollbarThumb) {
                imageScrollbar.classList.remove('hidden');
                var thumbHeight = Math.max(8, 100 / total);
                var thumbPosition = (this.viewer.currentImageIndex / (total - 1)) * (100 - thumbHeight);
                scrollbarThumb.style.height = thumbHeight + '%';
                scrollbarThumb.style.top = thumbPosition + '%';
            }
        }
    };

    /**
     * Updates the metadata panel
     * @param {Object} image - Cornerstone image object
     */
    UIController.prototype.updateMetadata = function (image) {
        var patientName = 'Desconocido';
        var patientId = 'N/A';
        var patientBirth = 'N/A';
        var patientSex = 'N/A';
        var studyDate = 'N/A';
        var studyDesc = 'N/A';
        var modality = 'N/A';
        var institution = 'N/A';

        if (image.data && image.data.string) {
            patientName = image.data.string('x00100010') || patientName;
            patientId = image.data.string('x00100020') || patientId;
            patientBirth = image.data.string('x00100030') || patientBirth;
            patientSex = image.data.string('x00100040') || patientSex;
            studyDate = image.data.string('x00080020') || studyDate;
            studyDesc = image.data.string('x00081030') || studyDesc;
            modality = image.data.string('x00080060') || modality;
            institution = image.data.string('x00080080') || institution;
        }

        var viewport = cornerstone.getViewport(this.viewer.element);
        var wc = viewport ? viewport.voi.windowCenter : 0;
        var ww = viewport ? viewport.voi.windowWidth : 0;

        document.getElementById('patient-info').innerHTML =
            '<div class="info-row"><span class="info-label">Nombre</span><span class="info-value">' + patientName + '</span></div>' +
            '<div class="info-row"><span class="info-label">ID</span><span class="info-value">' + patientId + '</span></div>' +
            '<div class="info-row"><span class="info-label">Nacimiento</span><span class="info-value">' + this.formatDate(patientBirth) + '</span></div>' +
            '<div class="info-row"><span class="info-label">Sexo</span><span class="info-value">' + patientSex + '</span></div>';

        document.getElementById('study-info').innerHTML =
            '<div class="info-row"><span class="info-label">Fecha</span><span class="info-value">' + this.formatDate(studyDate) + '</span></div>' +
            '<div class="info-row"><span class="info-label">Descripción</span><span class="info-value">' + studyDesc + '</span></div>' +
            '<div class="info-row"><span class="info-label">Modalidad</span><span class="info-value">' + modality + '</span></div>' +
            '<div class="info-row"><span class="info-label">Institución</span><span class="info-value">' + institution + '</span></div>';

        document.getElementById('image-info').innerHTML =
            '<div class="info-row"><span class="info-label">Dimensiones</span><span class="info-value">' + image.width + ' x ' + image.height + '</span></div>' +
            '<div class="info-row"><span class="info-label">Bits</span><span class="info-value">' + (image.bitsStored || 16) + ' bits</span></div>' +
            '<div class="info-row"><span class="info-label">Window Center</span><span class="info-value" id="wc-value">' + wc.toFixed(0) + '</span></div>' +
            '<div class="info-row"><span class="info-label">Window Width</span><span class="info-value" id="ww-value">' + ww.toFixed(0) + '</span></div>';
    };

    /**
     * Formats a DICOM date string
     * @param {string} dateStr - Date in YYYYMMDD format
     * @returns {string} Formatted date
     */
    UIController.prototype.formatDate = function (dateStr) {
        if (!dateStr || dateStr.length !== 8) return dateStr;
        return dateStr.slice(6, 8) + '/' + dateStr.slice(4, 6) + '/' + dateStr.slice(0, 4);
    };

    /**
     * Opens the About modal
     */
    UIController.prototype.openAboutModal = function () {
        var modal = document.getElementById('about-modal');
        var browserInfo = document.getElementById('browser-info');

        var ua = navigator.userAgent;
        var browser = 'Desconocido';
        var os = 'Desconocido';

        if (ua.includes('Chrome') && !ua.includes('Edg')) {
            var match = ua.match(/Chrome\/(\d+)/);
            browser = 'Chrome ' + (match ? match[1] : '');
        } else if (ua.includes('Firefox')) {
            var match = ua.match(/Firefox\/(\d+)/);
            browser = 'Firefox ' + (match ? match[1] : '');
        } else if (ua.includes('Safari') && !ua.includes('Chrome')) {
            var match = ua.match(/Version\/(\d+)/);
            browser = 'Safari ' + (match ? match[1] : '');
        } else if (ua.includes('Edg')) {
            var match = ua.match(/Edg\/(\d+)/);
            browser = 'Edge ' + (match ? match[1] : '');
        }

        if (ua.includes('Mac OS')) {
            var match = ua.match(/Mac OS X (\d+[._]\d+)/);
            os = 'macOS ' + (match ? match[1].replace('_', '.') : '');
        } else if (ua.includes('Windows')) {
            os = 'Windows';
        } else if (ua.includes('Linux')) {
            os = 'Linux';
        }

        browserInfo.textContent = browser + ', ' + os;
        modal.classList.remove('hidden');
    };

    /**
     * Closes the About modal
     */
    UIController.prototype.closeAboutModal = function () {
        document.getElementById('about-modal').classList.add('hidden');
    };

    /**
     * Sets up scrollbar events
     */
    UIController.prototype.setupScrollbarEvents = function () {
        var self = this;
        var scrollbar = document.getElementById('image-scrollbar');
        var track = scrollbar ? scrollbar.querySelector('.scrollbar-track') : null;
        var thumb = document.getElementById('scrollbar-thumb');

        if (!track || !thumb) return;

        var isDraggingThumb = false;

        thumb.addEventListener('mousedown', function (e) {
            isDraggingThumb = true;
            e.preventDefault();
        });

        document.addEventListener('mousemove', function (e) {
            if (!isDraggingThumb) return;

            var trackRect = track.getBoundingClientRect();
            var relativeY = e.clientY - trackRect.top;
            var percentage = Math.max(0, Math.min(1, relativeY / trackRect.height));
            var newIndex = Math.round(percentage * (self.viewer.imageIds.length - 1));

            if (newIndex !== self.viewer.currentImageIndex) {
                self.viewer.viewport.loadImage(newIndex);
            }
        });

        document.addEventListener('mouseup', function () {
            isDraggingThumb = false;
        });

        track.addEventListener('click', function (e) {
            if (e.target === thumb) return;

            var trackRect = track.getBoundingClientRect();
            var relativeY = e.clientY - trackRect.top;
            var percentage = Math.max(0, Math.min(1, relativeY / trackRect.height));
            var newIndex = Math.round(percentage * (self.viewer.imageIds.length - 1));

            self.viewer.viewport.loadImage(newIndex);
        });
    };

    /**
     * Resets wheel scroll state
     */
    UIController.prototype.resetWheelScroll = function () {
        this.wheelAccumulator = 0;
        this.isWheelScrolling = false;
        if (this.wheelScrollTimeout) {
            clearTimeout(this.wheelScrollTimeout);
            this.wheelScrollTimeout = null;
        }
    };

    return UIController;
})();
