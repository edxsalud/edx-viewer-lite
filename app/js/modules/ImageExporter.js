/**
 * ImageExporter - Module for image download and export functionality
 * Part of EDX Viewer Lite
 */
var ImageExporter = (function () {
    'use strict';

    /**
     * Creates a new ImageExporter instance
     * @param {DicomViewer} viewer - Reference to the main viewer instance
     */
    function ImageExporter(viewer) {
        this.viewer = viewer;
    }

    /**
     * Opens the download modal and initializes preview
     */
    ImageExporter.prototype.openDownloadModal = function () {
        var self = this;
        if (!this.viewer.element) return;

        var modal = document.getElementById('download-modal');
        var enabledElement = cornerstone.getEnabledElement(this.viewer.element);
        var image = enabledElement.image;

        // Set default values
        document.getElementById('download-width').value = image.width;
        document.getElementById('download-height').value = image.height;
        document.getElementById('download-filename').value = 'Image';

        modal.classList.remove('hidden');

        // Initial preview render
        setTimeout(function () {
            var previewElement = document.getElementById('preview-element');
            if (previewElement) {
                try {
                    cornerstone.enable(previewElement);
                } catch (e) { }

                cornerstone.resize(previewElement, true);
                self.updateDownloadPreview();
            }
        }, 50);
    };

    /**
     * Closes the download modal
     */
    ImageExporter.prototype.closeDownloadModal = function () {
        var modal = document.getElementById('download-modal');
        modal.classList.add('hidden');

        var previewElement = document.getElementById('preview-element');
        if (previewElement) {
            try {
                cornerstone.disable(previewElement);
            } catch (e) { }
        }
    };

    /**
     * Updates the download preview with current image and settings
     */
    ImageExporter.prototype.updateDownloadPreview = function () {
        var self = this;
        var previewElement = document.getElementById('preview-element');
        if (!this.viewer.element || !previewElement) return;

        // Force cleanup for fresh initialization
        if (previewElement.innerHTML !== '') {
            try {
                cornerstone.disable(previewElement);
            } catch (e) { }
            previewElement.innerHTML = '';
        }

        try {
            cornerstone.enable(previewElement);
        } catch (e) { }

        var mainEnabledElement = cornerstone.getEnabledElement(this.viewer.element);
        var image = mainEnabledElement.image;

        // Define render handler
        var onPreviewRendered = function (e) {
            previewElement.removeEventListener('cornerstoneimagerendered', onPreviewRendered);
            self.drawDownloadOverlays(previewElement);
        };

        previewElement.addEventListener('cornerstoneimagerendered', onPreviewRendered);

        cornerstone.displayImage(previewElement, image);
        cornerstone.fitToWindow(previewElement);

        var previewViewport = cornerstone.getViewport(previewElement);
        var mainViewport = mainEnabledElement.viewport;

        previewViewport.voi = { windowWidth: mainViewport.voi.windowWidth, windowCenter: mainViewport.voi.windowCenter };
        previewViewport.invert = mainViewport.invert;
        previewViewport.collation = mainViewport.collation;

        cornerstone.setViewport(previewElement, previewViewport);
        cornerstone.updateImage(previewElement);

        // Handle warning label visibility
        var includeWarning = document.getElementById('download-warning').checked;
        var warningEl = document.getElementById('preview-warning');
        if (warningEl) {
            warningEl.style.display = includeWarning ? 'block' : 'none';
        }
    };

    /**
     * Draws measurement overlays on the download preview
     * @param {HTMLElement} element - The preview element
     */
    ImageExporter.prototype.drawDownloadOverlays = function (element) {
        var self = this;
        var includeAnnotations = document.getElementById('download-annotations').checked;
        if (!includeAnnotations) return;

        var canvas = element.querySelector('canvas');
        if (!canvas) return;

        var ctx = canvas.getContext('2d');
        var enabledElement = cornerstone.getEnabledElement(element);
        var image = enabledElement.image;

        var pixelSpacing = {
            x: image.columnPixelSpacing || 1,
            y: image.rowPixelSpacing || 1,
            estimated: (!image.columnPixelSpacing || !image.rowPixelSpacing)
        };

        // Get measurements from the viewer's measurement tool
        var measurements = this.viewer.measurement ? this.viewer.measurement.measurements : [];
        var currentMeasurement = this.viewer.measurement ? this.viewer.measurement.currentMeasurement : null;

        var measurementsToDraw = measurements.filter(function (m) {
            return m.imageIndex === self.viewer.currentImageIndex &&
                (!m.seriesId || (self.viewer.currentSeries && m.seriesId === self.viewer.currentSeries.id));
        });

        if (currentMeasurement && currentMeasurement.imageIndex === this.viewer.currentImageIndex) {
            measurementsToDraw.push(currentMeasurement);
        }

        // HiDPI fix
        var dpr = canvas.width / canvas.clientWidth;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        if (dpr !== 1) {
            ctx.scale(dpr, dpr);
        }
        ctx.save();

        measurementsToDraw.forEach(function (m) {
            var start = cornerstone.pixelToCanvas(element, m.start);
            var end = cornerstone.pixelToCanvas(element, m.end);

            // Draw Line
            ctx.beginPath();
            ctx.strokeStyle = '#00ff00';
            ctx.lineWidth = 2;
            ctx.moveTo(start.x, start.y);
            ctx.lineTo(end.x, end.y);
            ctx.stroke();

            // Draw Endpoints
            ctx.fillStyle = '#00ff00';
            [start, end].forEach(function (p) {
                ctx.beginPath();
                ctx.arc(p.x, p.y, 3, 0, 2 * Math.PI);
                ctx.fill();
            });

            // Calculate distance
            var dx = m.end.x - m.start.x;
            var dy = m.end.y - m.start.y;
            var dxMm = dx * pixelSpacing.x;
            var dyMm = dy * pixelSpacing.y;
            var distance = Math.sqrt(dxMm * dxMm + dyMm * dyMm);

            var prefix = pixelSpacing.estimated ? '~' : '';
            var text = prefix + distance.toFixed(1) + ' mm';

            var midX = (start.x + end.x) / 2;
            var midY = (start.y + end.y) / 2;

            ctx.font = '13px Arial';
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'center';

            var textWidth = ctx.measureText(text).width + 8;

            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.fillRect(midX - textWidth / 2, midY - 12, textWidth, 24);

            ctx.fillStyle = '#00ff00';
            ctx.fillText(text, midX, midY);
        });

        ctx.restore();
    };

    /**
     * Saves the image with current settings
     */
    ImageExporter.prototype.saveImage = function () {
        var self = this;

        // Capture values NOW to ensure they're used in the async callback
        var config = {
            width: parseInt(document.getElementById('download-width').value) || 1024,
            height: parseInt(document.getElementById('download-height').value) || 1024,
            filename: document.getElementById('download-filename').value || 'Image',
            format: document.getElementById('download-format').value || 'jpg',
            includeWarning: document.getElementById('download-warning').checked
        };

        console.log('Save config:', config); // Debug log

        // Create temporary off-screen container
        var tempDiv = document.createElement('div');
        tempDiv.style.width = config.width + 'px';
        tempDiv.style.height = config.height + 'px';
        tempDiv.style.position = 'fixed';
        tempDiv.style.left = '0';
        tempDiv.style.top = '0';
        tempDiv.style.zIndex = '-1000';
        tempDiv.style.opacity = '0';
        tempDiv.style.pointerEvents = 'none';

        document.body.appendChild(tempDiv);

        try {
            cornerstone.enable(tempDiv);

            var mainEnabledElement = cornerstone.getEnabledElement(this.viewer.element);
            var image = mainEnabledElement.image;

            var onImageRendered = function (e) {
                console.log('5. cornerstoneimagerendered event fired!');
                tempDiv.removeEventListener('cornerstoneimagerendered', onImageRendered);

                setTimeout(function () {
                    console.log('6. Inside setTimeout callback');
                    try {
                        self.drawDownloadOverlays(tempDiv);
                        console.log('7. Overlays drawn');

                        var canvas = tempDiv.querySelector('canvas');
                        var ctx = canvas.getContext('2d');

                        if (config.includeWarning) {
                            ctx.save();
                            ctx.fillStyle = 'rgba(255, 0, 0, 0.4)';
                            ctx.font = 'bold 24px Arial';
                            ctx.textAlign = 'center';
                            ctx.textBaseline = 'bottom';

                            var wText = "No para uso diagnóstico";
                            var wWidth = ctx.measureText(wText).width + 30;

                            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
                            ctx.fillRect((canvas.width / 2) - (wWidth / 2), canvas.height - 40, wWidth, 34);

                            ctx.fillStyle = '#ff4444';
                            ctx.fillText(wText, canvas.width / 2, canvas.height - 12);
                            ctx.restore();
                        }

                        var mimeType = config.format === 'png' ? 'image/png' : 'image/jpeg';
                        var extension = config.format === 'png' ? 'png' : 'jpg';
                        var downloadFilename = config.filename + '.' + extension;

                        // Convert canvas to blob for File System Access API
                        canvas.toBlob(function (blob) {
                            if (!blob) {
                                alert('Error generando imagen');
                                return;
                            }

                            // Use File System Access API (shows native save dialog with correct name)
                            if ('showSaveFilePicker' in window) {
                                var opts = {
                                    suggestedName: downloadFilename,
                                    types: [{
                                        description: extension.toUpperCase() + ' Image',
                                        accept: {}
                                    }]
                                };
                                opts.types[0].accept[mimeType] = ['.' + extension];

                                window.showSaveFilePicker(opts).then(function (handle) {
                                    return handle.createWritable();
                                }).then(function (writable) {
                                    return writable.write(blob).then(function () {
                                        return writable.close();
                                    });
                                }).then(function () {
                                    console.log('✅ Imagen guardada correctamente como:', downloadFilename);
                                }).catch(function (err) {
                                    if (err.name !== 'AbortError') {
                                        console.error('Error al guardar:', err);
                                        alert('Error al guardar: ' + err.message);
                                    }
                                });
                            } else {
                                // Fallback for Firefox/Safari: open image in new tab
                                var blobUrl = URL.createObjectURL(blob);
                                var newWindow = window.open('', '_blank');
                                if (newWindow) {
                                    newWindow.document.write(
                                        '<!DOCTYPE html><html><head>' +
                                        '<title>' + downloadFilename + '</title>' +
                                        '<style>' +
                                        'body{margin:0;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;background:#1a1a2e;font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:white;}' +
                                        '.box{background:rgba(0,0,0,0.8);padding:20px 30px;border-radius:12px;margin-bottom:20px;text-align:center;max-width:90%;}' +
                                        'h2{margin:0 0 10px 0;color:#4ade80;}' +
                                        'p{margin:5px 0;color:#ccc;}' +
                                        '.filename{color:#60a5fa;font-weight:bold;font-family:monospace;background:#1e3a5f;padding:4px 10px;border-radius:4px;}' +
                                        'img{max-width:90%;max-height:70vh;box-shadow:0 8px 32px rgba(0,0,0,0.5);border-radius:8px;}' +
                                        '</style></head><body>' +
                                        '<div class="box">' +
                                        '<h2>📥 Guardar Imagen</h2>' +
                                        '<p>Haz <strong>clic derecho</strong> en la imagen → <strong>"Guardar imagen como..."</strong></p>' +
                                        '<p>Nombre sugerido: <span class="filename">' + downloadFilename + '</span></p>' +
                                        '</div>' +
                                        '<img src="' + blobUrl + '" alt="' + downloadFilename + '"/>' +
                                        '</body></html>'
                                    );
                                    newWindow.document.close();
                                } else {
                                    // Popup blocked - try direct download as last resort
                                    var link = document.createElement('a');
                                    link.href = blobUrl;
                                    link.download = downloadFilename;
                                    document.body.appendChild(link);
                                    link.click();
                                    document.body.removeChild(link);
                                }

                                // Revoke blob URL after delay
                                setTimeout(function () {
                                    URL.revokeObjectURL(blobUrl);
                                }, 60000); // Keep for 1 minute
                            }

                            self.closeDownloadModal();

                        }, mimeType, 0.95);

                    } catch (err) {
                        console.error('Error during download processing:', err);
                        alert('Error procesando la imagen descargada.');
                    } finally {
                        try { cornerstone.disable(tempDiv); } catch (e) { }
                        if (tempDiv.parentNode) document.body.removeChild(tempDiv);
                    }
                }, 50);
            };

            tempDiv.addEventListener('cornerstoneimagerendered', onImageRendered);
            console.log('1. Event listener added, displaying image...');
            cornerstone.displayImage(tempDiv, image);
            console.log('2. Image display called');

            var vp = cornerstone.getViewport(tempDiv);
            vp.voi = { windowWidth: mainEnabledElement.viewport.voi.windowWidth, windowCenter: mainEnabledElement.viewport.voi.windowCenter };
            vp.invert = mainEnabledElement.viewport.invert;
            cornerstone.setViewport(tempDiv, vp);
            console.log('3. Viewport set');

            cornerstone.fitToWindow(tempDiv);
            cornerstone.updateImage(tempDiv);
            console.log('4. Update image called - waiting for render event...');

        } catch (e) {
            console.error('Error initiating download:', e);
            document.body.removeChild(tempDiv);
        }
    };

    return ImageExporter;
})();
