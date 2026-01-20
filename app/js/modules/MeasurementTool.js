/**
 * MeasurementTool - Module for ruler/length measurement annotations
 * Part of EDX Viewer Lite
 */
var MeasurementTool = (function () {
    'use strict';

    /**
     * Creates a new MeasurementTool instance
     * @param {DicomViewer} viewer - Reference to the main viewer instance
     */
    function MeasurementTool(viewer) {
        this.viewer = viewer;
        this.measurements = [];
        this.currentMeasurement = null;
        this.isDrawingMeasurement = false;
        this.measurementStart = null;
    }

    /**
     * Handles mousedown event for starting a measurement
     * @param {MouseEvent} e - Mouse event
     * @returns {boolean} True if measurement was started
     */
    MeasurementTool.prototype.handleMouseDown = function (e) {
        if (this.viewer.activeTool !== 'length') return false;
        if (!this.viewer.element) return false;

        var imagePoint = cornerstone.pageToPixel(this.viewer.element, e.pageX, e.pageY);

        if (!this.isDrawingMeasurement) {
            this.isDrawingMeasurement = true;
            this.measurementStart = imagePoint;
            this.currentMeasurement = {
                start: imagePoint,
                end: imagePoint,
                imageIndex: this.viewer.currentImageIndex,
                seriesId: this.viewer.currentSeries ? this.viewer.currentSeries.id : null
            };
        }
        return true;
    };

    /**
     * Handles mousemove event for updating measurement during drawing
     * @param {MouseEvent} e - Mouse event
     * @returns {boolean} True if measurement was updated
     */
    MeasurementTool.prototype.handleMouseMove = function (e) {
        if (this.viewer.activeTool !== 'length') return false;
        if (!this.isDrawingMeasurement) return false;
        if (!this.viewer.element) return false;

        var imagePoint = cornerstone.pageToPixel(this.viewer.element, e.pageX, e.pageY);
        this.currentMeasurement.end = imagePoint;
        this.drawMeasurements();
        return true;
    };

    /**
     * Handles mouseup event for completing a measurement
     * @param {MouseEvent} e - Mouse event
     * @returns {boolean} True if measurement was completed
     */
    MeasurementTool.prototype.handleMouseUp = function (e) {
        if (this.viewer.activeTool !== 'length') return false;
        if (!this.isDrawingMeasurement) return false;
        if (!this.viewer.element) return false;

        var imagePoint = cornerstone.pageToPixel(this.viewer.element, e.pageX, e.pageY);
        this.currentMeasurement.end = imagePoint;

        // Save the completed measurement
        this.measurements.push({
            start: this.currentMeasurement.start,
            end: this.currentMeasurement.end,
            imageIndex: this.currentMeasurement.imageIndex,
            seriesId: this.currentMeasurement.seriesId
        });

        this.isDrawingMeasurement = false;
        this.currentMeasurement = null;
        this.drawMeasurements();
        return true;
    };

    /**
     * Draws all measurements on the current image
     */
    MeasurementTool.prototype.drawMeasurements = function () {
        var self = this;
        var element = this.viewer.element;
        if (!element) return;

        // Get or create the SVG overlay
        var svg = element.querySelector('.measurement-overlay');
        if (!svg) {
            svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.classList.add('measurement-overlay');
            svg.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 10;';
            element.appendChild(svg);
        }

        svg.innerHTML = '';

        // Get pixel spacing from current image
        var pixelSpacing = this.getPixelSpacing();

        // Draw all measurements for current image AND current series
        var measurementsToDraw = this.measurements.filter(function (m) {
            return m.imageIndex === self.viewer.currentImageIndex &&
                (!m.seriesId || (self.viewer.currentSeries && m.seriesId === self.viewer.currentSeries.id));
        });

        // Add current measurement being drawn
        if (this.currentMeasurement && this.currentMeasurement.imageIndex === this.viewer.currentImageIndex) {
            measurementsToDraw.push(this.currentMeasurement);
        }

        measurementsToDraw.forEach(function (measurement) {
            var start = cornerstone.pixelToCanvas(element, measurement.start);
            var end = cornerstone.pixelToCanvas(element, measurement.end);

            // Draw line
            var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', start.x);
            line.setAttribute('y1', start.y);
            line.setAttribute('x2', end.x);
            line.setAttribute('y2', end.y);
            line.setAttribute('stroke', '#00ff00');
            line.setAttribute('stroke-width', '2');
            svg.appendChild(line);

            // Draw endpoints
            [start, end].forEach(function (point) {
                var circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle.setAttribute('cx', point.x);
                circle.setAttribute('cy', point.y);
                circle.setAttribute('r', '4');
                circle.setAttribute('fill', '#00ff00');
                svg.appendChild(circle);
            });

            // Calculate distance in mm
            var dx = measurement.end.x - measurement.start.x;
            var dy = measurement.end.y - measurement.start.y;
            var dxMm = dx * pixelSpacing.x;
            var dyMm = dy * pixelSpacing.y;
            var distance = Math.sqrt(dxMm * dxMm + dyMm * dyMm);

            // Show ~ prefix if using estimated pixel spacing
            var prefix = pixelSpacing.estimated ? '~' : '';
            var displayText = prefix + distance.toFixed(1) + ' mm';

            // Draw text label
            var midX = (start.x + end.x) / 2;
            var midY = (start.y + end.y) / 2;

            // Calculate text width for background
            var textWidth = displayText.length * 7 + 10;

            // Background for text
            var textBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            textBg.setAttribute('x', midX - textWidth / 2);
            textBg.setAttribute('y', midY - 20);
            textBg.setAttribute('width', textWidth);
            textBg.setAttribute('height', '18');
            textBg.setAttribute('fill', 'rgba(0,0,0,0.7)');
            textBg.setAttribute('rx', '3');
            svg.appendChild(textBg);

            var text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', midX);
            text.setAttribute('y', midY - 7);
            text.setAttribute('fill', pixelSpacing.estimated ? '#ffcc00' : '#00ff00');
            text.setAttribute('font-size', '12');
            text.setAttribute('font-family', 'Arial, sans-serif');
            text.setAttribute('text-anchor', 'middle');
            text.textContent = displayText;
            svg.appendChild(text);

            // Add delete button (X) if it's not the current measurement
            if (measurement !== self.currentMeasurement) {
                var deleteBtnGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                deleteBtnGroup.style.cursor = 'pointer';
                deleteBtnGroup.style.pointerEvents = 'all';

                var btnX = midX + textWidth / 2 + 10;
                var btnY = midY - 11;

                var btnCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                btnCircle.setAttribute('cx', btnX);
                btnCircle.setAttribute('cy', btnY);
                btnCircle.setAttribute('r', '8');
                btnCircle.setAttribute('fill', '#ff4444');
                btnCircle.setAttribute('stroke', '#fff');
                btnCircle.setAttribute('stroke-width', '1');

                var xMark = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                xMark.setAttribute('x', btnX);
                xMark.setAttribute('y', btnY + 3);
                xMark.setAttribute('text-anchor', 'middle');
                xMark.setAttribute('fill', '#fff');
                xMark.setAttribute('font-size', '10');
                xMark.setAttribute('font-weight', 'bold');
                xMark.setAttribute('font-family', 'Arial, sans-serif');
                xMark.textContent = '×';

                deleteBtnGroup.appendChild(btnCircle);
                deleteBtnGroup.appendChild(xMark);

                // Closure to capture measurement reference
                (function (m) {
                    deleteBtnGroup.addEventListener('mousedown', function (e) {
                        e.stopPropagation();
                        self.removeMeasurement(m);
                    });
                })(measurement);

                svg.appendChild(deleteBtnGroup);
            }
        });
    };

    /**
     * Gets the pixel spacing from the current image
     * @returns {Object} Pixel spacing {x, y, estimated}
     */
    MeasurementTool.prototype.getPixelSpacing = function () {
        try {
            var enabledElement = cornerstone.getEnabledElement(this.viewer.element);
            if (enabledElement && enabledElement.image) {
                var image = enabledElement.image;

                // Method 1: Check rowPixelSpacing and columnPixelSpacing
                if (image.rowPixelSpacing && image.columnPixelSpacing) {
                    return {
                        y: image.rowPixelSpacing,
                        x: image.columnPixelSpacing
                    };
                }

                // Method 2: Get from DICOM data directly
                if (image.data && image.data.string) {
                    var pixelSpacingStr = image.data.string('x00280030');

                    if (!pixelSpacingStr) {
                        pixelSpacingStr = image.data.string('x00181164');
                    }

                    if (pixelSpacingStr) {
                        var parts = pixelSpacingStr.split('\\');
                        if (parts.length >= 2) {
                            var rowSpacing = parseFloat(parts[0]);
                            var colSpacing = parseFloat(parts[1]);
                            if (!isNaN(rowSpacing) && !isNaN(colSpacing) && rowSpacing > 0 && colSpacing > 0) {
                                return {
                                    y: rowSpacing,
                                    x: colSpacing
                                };
                            }
                        }
                    }
                }
            }
        } catch (e) {
            console.warn('Could not get pixel spacing:', e);
        }

        return { x: 1, y: 1, estimated: true };
    };

    /**
     * Removes a specific measurement
     * @param {Object} measurementToRemove - The measurement to remove
     */
    MeasurementTool.prototype.removeMeasurement = function (measurementToRemove) {
        this.measurements = this.measurements.filter(function (m) {
            return m !== measurementToRemove;
        });
        this.drawMeasurements();
    };

    /**
     * Clears measurements for the current image/series
     */
    MeasurementTool.prototype.clearMeasurements = function () {
        var self = this;
        this.measurements = this.measurements.filter(function (m) {
            return !(m.imageIndex === self.viewer.currentImageIndex &&
                (!m.seriesId || (self.viewer.currentSeries && m.seriesId === self.viewer.currentSeries.id)));
        });
        this.drawMeasurements();
    };

    return MeasurementTool;
})();
