// Initialize Cornerstone and WADO Image Loader
cornerstoneWADOImageLoader.external.cornerstone = cornerstone;
cornerstoneWADOImageLoader.external.dicomParser = dicomParser;

// Configure WADO Image Loader for local files
cornerstoneWADOImageLoader.configure({
    useWebWorkers: false,
    decodeConfig: {
        usePDFJS: false
    }
});

// Main application
class DicomViewer {
    constructor() {
        this.studies = [];
        this.currentSeries = null;
        this.currentImageIndex = 0;
        this.element = null;
        this.activeTool = 'wwwc';
        this.imageIds = [];
        this.fileMap = new Map(); // Maps imageId to File object
        this.measurements = []; // Store measurement data
        this.isDrawingMeasurement = false;
        this.measurementStart = null;

        this.init();
    }

    init() {
        this.setupEventListeners();
        this.setupDropZone();
        this.setupScrollbarEvents();
    }

    setupViewport() {
        const container = document.getElementById('dicom-viewport');

        // Hide instructions zone
        const instructionsZone = document.getElementById('instructions-zone');
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

        // Enable Cornerstone on the new element
        cornerstone.enable(this.element);
        this.viewportInitialized = true;

        // Re-setup mouse events on new element
        this.setupViewportEvents();

        // Listen for image rendered event to redraw measurements on pan/zoom
        this.element.addEventListener('cornerstoneimagerendered', () => {
            this.drawMeasurements();
        });
    }

    setupDropZone() {
        const dropZone = document.getElementById('drop-zone');
        const viewport = document.getElementById('dicom-viewport');

        // Prevent default drag behaviors on the whole document
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            document.body.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
        });

        // Drag and drop events on viewport
        ['dragenter', 'dragover'].forEach(eventName => {
            viewport.addEventListener(eventName, () => {
                if (dropZone) dropZone.classList.add('drag-over');
            });
        });

        ['dragleave', 'drop'].forEach(eventName => {
            viewport.addEventListener(eventName, () => {
                if (dropZone) dropZone.classList.remove('drag-over');
            });
        });

        viewport.addEventListener('drop', async (e) => {
            console.log('Drop event fired');

            // Try to get files from dataTransfer.items first (for folder support)
            if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
                const items = e.dataTransfer.items;
                const hasWebkitEntry = items[0] && items[0].webkitGetAsEntry;

                if (hasWebkitEntry) {
                    await this.handleDroppedItems(items);
                    return;
                }
            }

            // Fallback: use dataTransfer.files directly
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                console.log('Using files fallback:', e.dataTransfer.files.length, 'files');
                this.handleFiles(Array.from(e.dataTransfer.files));
            }
        });

        // Folder button
        document.getElementById('btn-load-folder').addEventListener('click', () => {
            document.getElementById('folder-input').click();
        });

        // Folder input
        document.getElementById('folder-input').addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.handleFiles(Array.from(e.target.files));
            }
        });
    }

    async handleDroppedItems(items) {
        console.log('handleDroppedItems called with', items.length, 'items');
        const files = [];

        // Helper to read ALL entries from a directory (readEntries returns max 100 at a time)
        const readAllDirectoryEntries = async (dirReader) => {
            const entries = [];
            let batch = await new Promise((resolve, reject) => {
                dirReader.readEntries(resolve, reject);
            });

            while (batch.length > 0) {
                entries.push(...batch);
                batch = await new Promise((resolve, reject) => {
                    dirReader.readEntries(resolve, reject);
                });
            }
            return entries;
        };

        const traverseFileTree = async (entry, path = '') => {
            if (entry.isFile) {
                try {
                    const file = await new Promise((resolve, reject) => {
                        entry.file(resolve, reject);
                    });
                    // Preserve relative path for organization
                    Object.defineProperty(file, 'relativePath', {
                        value: path + file.name,
                        writable: false
                    });
                    files.push(file);
                } catch (err) {
                    console.warn('Error reading file:', entry.name, err);
                }
            } else if (entry.isDirectory) {
                try {
                    const dirReader = entry.createReader();
                    const entries = await readAllDirectoryEntries(dirReader);
                    console.log(`Directory "${entry.name}" has ${entries.length} entries`);

                    for (const childEntry of entries) {
                        await traverseFileTree(childEntry, path + entry.name + '/');
                    }
                } catch (err) {
                    console.warn('Error reading directory:', entry.name, err);
                }
            }
        };

        // Process all dropped items
        for (let i = 0; i < items.length; i++) {
            const entry = items[i].webkitGetAsEntry();
            if (entry) {
                console.log('Processing entry:', entry.name, 'isDirectory:', entry.isDirectory);
                await traverseFileTree(entry);
            }
        }

        console.log('Total files collected:', files.length);

        if (files.length > 0) {
            this.handleFiles(files);
        } else {
            alert('No se encontraron archivos en la carpeta');
        }
    }

    async handleFiles(files) {
        // Filter DICOM files
        const dicomFiles = files.filter(file => {
            const name = file.name.toLowerCase();
            return name.endsWith('.dcm') || !name.includes('.');
        });

        if (dicomFiles.length === 0) {
            alert('No se encontraron archivos DICOM válidos');
            return;
        }

        // Parse and organize files
        await this.parseAndOrganizeFiles(dicomFiles);
        this.renderStudiesList();

        // Automatically open the first series of the first study
        if (this.studies.length > 0) {
            const firstStudy = this.studies[0];
            const seriesIds = Object.keys(firstStudy.series);
            if (seriesIds.length > 0) {
                const firstSeriesId = seriesIds[0];

                // Expand the series list dropdown
                const seriesList = document.getElementById('series-0');
                if (seriesList) {
                    seriesList.classList.add('expanded');
                }

                // Mark the first series as active in the UI
                const firstSeriesElement = document.querySelector(`#series-0 .series-item`);
                if (firstSeriesElement) {
                    firstSeriesElement.classList.add('active');
                }

                // Load the first series
                await this.selectSeriesDirectly(0, firstSeriesId);
            }
        }
    }

    // Helper method to select series without relying on event.target
    async selectSeriesDirectly(studyIdx, seriesId) {
        const study = this.studies[studyIdx];
        const series = study.series[seriesId];

        this.currentSeries = series;
        this.currentImageIndex = 0;

        // Reset wheel scroll state when changing series
        this.resetWheelScroll();

        // Check if this is a Structured Report series
        if (series.modality === 'SR') {
            this.viewportInitialized = false;
            await this.loadStructuredReport(series);
            return;
        }

        // Initialize viewport
        this.setupViewport();

        // Create image IDs array
        this.imageIds = series.images.map(img => img.imageId);
        this.invalidImageIndices = new Set();

        // Load first valid image
        await this.loadFirstValidImage();
        this.updateNavigation();
    }

    async parseAndOrganizeFiles(files) {
        this.studies = [];
        const studiesMap = {};

        for (const file of files) {
            try {
                const arrayBuffer = await file.arrayBuffer();
                const dataSet = dicomParser.parseDicom(new Uint8Array(arrayBuffer));

                // Extract metadata
                const studyUID = dataSet.string('x0020000d') || 'UnknownStudy';
                const seriesUID = dataSet.string('x0020000e') || 'UnknownSeries';
                const studyDescription = dataSet.string('x00081030') || 'Estudio';
                const seriesDescription = dataSet.string('x0008103e') || '';
                const modality = dataSet.string('x00080060') || 'OT';
                const instanceNumber = parseInt(dataSet.string('x00200013')) || 0;

                // Create study if not exists
                if (!studiesMap[studyUID]) {
                    studiesMap[studyUID] = {
                        id: studyUID,
                        description: studyDescription,
                        modality: modality,
                        series: {}
                    };
                }

                // Create series if not exists
                if (!studiesMap[studyUID].series[seriesUID]) {
                    studiesMap[studyUID].series[seriesUID] = {
                        id: seriesUID,
                        description: seriesDescription,
                        modality: modality,
                        images: []
                    };
                }

                // Register file with Cornerstone
                const imageId = cornerstoneWADOImageLoader.wadouri.fileManager.add(file);
                this.fileMap.set(imageId, file);

                studiesMap[studyUID].series[seriesUID].images.push({
                    imageId: imageId,
                    instanceNumber: instanceNumber,
                    file: file
                });

            } catch (e) {
                console.warn('Error parsing file:', file.name, e);
            }
        }

        // Sort images in each series
        for (const studyUID in studiesMap) {
            for (const seriesUID in studiesMap[studyUID].series) {
                studiesMap[studyUID].series[seriesUID].images.sort((a, b) =>
                    a.instanceNumber - b.instanceNumber
                );
            }
        }

        this.studies = Object.values(studiesMap);
    }

    renderStudiesList() {
        const container = document.getElementById('studies-list');

        if (this.studies.length === 0) {
            container.innerHTML = `
                <div class="no-studies-message">
                    <i class="fas fa-cloud-upload-alt"></i>
                    <p>Carga archivos DICOM para comenzar</p>
                </div>
            `;
            return;
        }

        container.innerHTML = this.studies.map((study, idx) => `
            <div class="study-item" data-study-idx="${idx}">
                <div class="study-header" onclick="viewer.toggleStudy(${idx})">
                    <span class="study-icon"><i class="fas fa-x-ray"></i></span>
                    <div class="study-title">
                        <h3>${study.description || `Estudio ${idx + 1}`} ${study.modality ? `(${study.modality})` : ''}</h3>
                        <span>${Object.keys(study.series).length} series</span>
                    </div>
                </div>
                <div class="series-list" id="series-${idx}">
                    ${Object.values(study.series).map((series, sIdx) => {
            const modality = series.modality || 'IMG';
            const icon = modality === 'SR' ? '<i class="fas fa-file-medical-alt"></i>' : '<i class="fas fa-film"></i>';
            const description = series.description ? ` - ${series.description}` : '';
            const countLabel = modality === 'SR' ? 'SR' : series.images.length;
            return `
                            <div class="series-item" onclick="viewer.selectSeries(${idx}, '${series.id}')" title="${series.description || ''}">
                                ${icon} Serie ${sIdx + 1}${description} (${countLabel})
                            </div>
                        `;
        }).join('')}
                </div>
            </div>
        `).join('');
    }

    toggleStudy(idx) {
        const seriesList = document.getElementById(`series-${idx}`);
        seriesList.classList.toggle('expanded');
    }

    async selectSeries(studyIdx, seriesId) {
        // Update UI
        document.querySelectorAll('.series-item').forEach(el => el.classList.remove('active'));
        event.target.classList.add('active');

        const study = this.studies[studyIdx];
        const series = study.series[seriesId];

        this.currentSeries = series;
        this.currentImageIndex = 0;

        // Reset wheel scroll state when changing series
        this.resetWheelScroll();

        // Check if this is a Structured Report series
        if (series.modality === 'SR') {
            this.viewportInitialized = false;
            await this.loadStructuredReport(series);
            return;
        }

        // Initialize viewport
        this.setupViewport();

        // Create image IDs array
        this.imageIds = series.images.map(img => img.imageId);
        this.invalidImageIndices = new Set();

        // Load first valid image
        await this.loadFirstValidImage();
        this.updateNavigation();
    }

    async loadFirstValidImage() {
        for (let i = 0; i < this.imageIds.length; i++) {
            if (this.invalidImageIndices.has(i)) continue;

            const success = await this.tryLoadImage(i);
            if (success) {
                this.currentImageIndex = i;
                return;
            }
        }

        this.viewportInitialized = false;
        await this.handleNonImageDicom(0);
    }

    async tryLoadImage(index) {
        try {
            if (!this.viewportInitialized) {
                this.setupViewport();
            }

            const imageId = this.imageIds[index];
            const image = await cornerstone.loadImage(imageId);
            cornerstone.displayImage(this.element, image);
            this.updateMetadata(image);
            return true;
        } catch (error) {
            this.invalidImageIndices.add(index);
            return false;
        }
    }

    async loadStructuredReport(series) {
        try {
            if (this.element) {
                try {
                    cornerstone.disable(this.element);
                } catch (e) { }
                this.element = null;
            }

            const viewport = document.getElementById('dicom-viewport');
            const file = series.images[0].file;
            const arrayBuffer = await file.arrayBuffer();
            const srContent = this.parseSRContent(arrayBuffer);

            viewport.innerHTML = `
                <div class="sr-viewer">
                    <div class="sr-header">
                        <h3><i class="fas fa-file-medical-alt"></i> Reporte Estructurado (SR)</h3>
                    </div>
                    <div class="sr-content">
                        ${srContent}
                    </div>
                </div>
            `;

            this.imageIds = [];
            document.getElementById('image-counter').textContent = 'Reporte';
            this.updateNavigation();
            this.updateSRMetadata(arrayBuffer);

        } catch (error) {
            console.error('Error loading SR:', error);
            const viewport = document.getElementById('dicom-viewport');
            viewport.innerHTML = `<div class="sr-viewer"><p style="color: #ef4444;">Error al cargar el reporte: ${error.message}</p></div>`;
        }
    }

    parseSRContent(arrayBuffer) {
        try {
            const dataSet = dicomParser.parseDicom(new Uint8Array(arrayBuffer));
            const texts = [];

            for (let tag in dataSet.elements) {
                const element = dataSet.elements[tag];
                if (element.length && element.length < 10000) {
                    try {
                        const value = dataSet.string(tag);
                        if (value && value.length > 2 && /[a-zA-Z]/.test(value)) {
                            if (!value.match(/^[0-9.]+$/) && !value.match(/^[A-Z0-9]{64}$/)) {
                                texts.push(value);
                            }
                        }
                    } catch (e) { }
                }
            }

            if (texts.length > 0) {
                return texts.map(t => `<p>${t}</p>`).join('');
            }
            return '<p style="color: var(--text-secondary);">Este reporte no contiene texto legible directamente.</p>';
        } catch (e) {
            return `<p style="color: #ef4444;">No se pudo parsear el contenido del SR: ${e.message}</p>`;
        }
    }

    updateSRMetadata(arrayBuffer) {
        try {
            const dataSet = dicomParser.parseDicom(new Uint8Array(arrayBuffer));

            const patientName = dataSet.string('x00100010') || 'Desconocido';
            const patientId = dataSet.string('x00100020') || 'N/A';
            const patientBirth = dataSet.string('x00100030') || 'N/A';
            const patientSex = dataSet.string('x00100040') || 'N/A';
            const studyDate = dataSet.string('x00080020') || 'N/A';
            const studyDesc = dataSet.string('x00081030') || 'N/A';
            const modality = dataSet.string('x00080060') || 'SR';
            const institution = dataSet.string('x00080080') || 'N/A';

            document.getElementById('patient-info').innerHTML = `
                <div class="info-row"><span class="info-label">Nombre</span><span class="info-value">${patientName}</span></div>
                <div class="info-row"><span class="info-label">ID</span><span class="info-value">${patientId}</span></div>
                <div class="info-row"><span class="info-label">Nacimiento</span><span class="info-value">${this.formatDate(patientBirth)}</span></div>
                <div class="info-row"><span class="info-label">Sexo</span><span class="info-value">${patientSex}</span></div>
            `;

            document.getElementById('study-info').innerHTML = `
                <div class="info-row"><span class="info-label">Fecha</span><span class="info-value">${this.formatDate(studyDate)}</span></div>
                <div class="info-row"><span class="info-label">Descripción</span><span class="info-value">${studyDesc}</span></div>
                <div class="info-row"><span class="info-label">Modalidad</span><span class="info-value">${modality}</span></div>
                <div class="info-row"><span class="info-label">Institución</span><span class="info-value">${institution}</span></div>
            `;

            document.getElementById('image-info').innerHTML = `
                <div class="info-row"><span class="info-label">Tipo</span><span class="info-value">Reporte Estructurado</span></div>
                <div class="info-row"><span class="info-label">Modalidad</span><span class="info-value">${modality}</span></div>
            `;
        } catch (e) {
            console.error('Error parsing SR metadata:', e);
        }
    }

    async loadImage(index, direction = 1) {
        if (!this.imageIds.length || index < 0 || index >= this.imageIds.length) return;

        if (this.invalidImageIndices && this.invalidImageIndices.has(index)) {
            const nextIndex = index + direction;
            if (nextIndex >= 0 && nextIndex < this.imageIds.length) {
                return this.loadImage(nextIndex, direction);
            }
            return;
        }

        this.currentImageIndex = index;
        const imageId = this.imageIds[index];

        try {
            if (!this.viewportInitialized) {
                this.setupViewport();
            }

            const image = await cornerstone.loadImage(imageId);
            cornerstone.displayImage(this.element, image);
            this.updateMetadata(image);
            this.updateNavigation();

        } catch (error) {
            if (!this.invalidImageIndices) {
                this.invalidImageIndices = new Set();
            }
            this.invalidImageIndices.add(index);

            const nextIndex = index + direction;
            if (nextIndex >= 0 && nextIndex < this.imageIds.length) {
                return this.loadImage(nextIndex, direction);
            }

            await this.handleNonImageDicom(index);
        }
    }

    async handleNonImageDicom(index) {
        try {
            this.viewportInitialized = false;

            if (this.element) {
                try {
                    cornerstone.disable(this.element);
                } catch (e) { }
                this.element = null;
            }

            const file = this.currentSeries.images[index].file;
            const arrayBuffer = await file.arrayBuffer();
            const srContent = this.parseSRContent(arrayBuffer);

            const viewport = document.getElementById('dicom-viewport');
            viewport.innerHTML = `
                <div class="sr-viewer">
                    <div class="sr-header">
                        <h3><i class="fas fa-file-medical"></i> Documento DICOM (sin imagen)</h3>
                    </div>
                    <div class="sr-content">
                        ${srContent}
                    </div>
                </div>
            `;

            this.updateSRMetadata(arrayBuffer);
            this.updateNavigation();

        } catch (e) {
            console.error('Error handling non-image DICOM:', e);
        }
    }

    updateMetadata(image) {
        let patientName = 'Desconocido';
        let patientId = 'N/A';
        let patientBirth = 'N/A';
        let patientSex = 'N/A';
        let studyDate = 'N/A';
        let studyDesc = 'N/A';
        let modality = 'N/A';
        let institution = 'N/A';

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

        const viewport = cornerstone.getViewport(this.element);
        const wc = viewport ? viewport.voi.windowCenter : 0;
        const ww = viewport ? viewport.voi.windowWidth : 0;

        document.getElementById('patient-info').innerHTML = `
            <div class="info-row"><span class="info-label">Nombre</span><span class="info-value">${patientName}</span></div>
            <div class="info-row"><span class="info-label">ID</span><span class="info-value">${patientId}</span></div>
            <div class="info-row"><span class="info-label">Nacimiento</span><span class="info-value">${this.formatDate(patientBirth)}</span></div>
            <div class="info-row"><span class="info-label">Sexo</span><span class="info-value">${patientSex}</span></div>
        `;

        document.getElementById('study-info').innerHTML = `
            <div class="info-row"><span class="info-label">Fecha</span><span class="info-value">${this.formatDate(studyDate)}</span></div>
            <div class="info-row"><span class="info-label">Descripción</span><span class="info-value">${studyDesc}</span></div>
            <div class="info-row"><span class="info-label">Modalidad</span><span class="info-value">${modality}</span></div>
            <div class="info-row"><span class="info-label">Institución</span><span class="info-value">${institution}</span></div>
        `;

        document.getElementById('image-info').innerHTML = `
            <div class="info-row"><span class="info-label">Dimensiones</span><span class="info-value">${image.width} x ${image.height}</span></div>
            <div class="info-row"><span class="info-label">Bits</span><span class="info-value">${image.bitsStored || 16} bits</span></div>
            <div class="info-row"><span class="info-label">Window Center</span><span class="info-value" id="wc-value">${wc.toFixed(0)}</span></div>
            <div class="info-row"><span class="info-label">Window Width</span><span class="info-value" id="ww-value">${ww.toFixed(0)}</span></div>
        `;
    }

    formatDate(dateStr) {
        if (!dateStr || dateStr.length !== 8) return dateStr;
        return `${dateStr.slice(6, 8)}/${dateStr.slice(4, 6)}/${dateStr.slice(0, 4)}`;
    }

    setupEventListeners() {
        document.getElementById('tool-pan').onclick = () => this.setTool('pan');
        document.getElementById('tool-zoom').onclick = () => this.setTool('zoom');
        document.getElementById('tool-wwwc').onclick = () => this.setTool('wwwc');
        document.getElementById('tool-length').onclick = () => this.setTool('length');
        document.getElementById('tool-stackscroll').onclick = () => this.setTool('stackscroll');
        document.getElementById('tool-reset').onclick = () => this.resetView();

        // About modal
        document.getElementById('btn-about').onclick = () => this.openAboutModal();

        // Close modal on overlay click
        document.getElementById('about-modal').onclick = (e) => {
            if (e.target.id === 'about-modal') this.closeAboutModal();
        };

        // Download modal
        document.getElementById('tool-download').onclick = () => this.openDownloadModal();

        document.getElementById('download-modal').onclick = (e) => {
            if (e.target.id === 'download-modal') this.closeDownloadModal();
        };

        // Download input changes - Add listeners for ALL inputs affecting preview
        ['download-width', 'download-height', 'download-format', 'download-annotations', 'download-warning'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('change', () => this.updateDownloadPreview());
        });

        // Navigation
        document.getElementById('prev-image').onclick = () => this.navigate(-1);
        document.getElementById('next-image').onclick = () => this.navigate(1);

        // Keyboard navigation
        document.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') this.navigate(-1);
            if (e.key === 'ArrowDown' || e.key === 'ArrowRight') this.navigate(1);
            if (e.key === 'Escape') this.closeAboutModal();
        });
    }

    openDownloadModal() {
        if (!this.element) return;

        const modal = document.getElementById('download-modal');
        const enabledElement = cornerstone.getEnabledElement(this.element);
        const image = enabledElement.image;

        // Set default values
        document.getElementById('download-width').value = image.width;
        document.getElementById('download-height').value = image.height;
        document.getElementById('download-filename').value = 'Image';

        modal.classList.remove('hidden');

        // Initial preview render
        // We use a timeout to ensure modal is visible and layout is calculated
        setTimeout(() => {
            const previewElement = document.getElementById('preview-element');
            if (previewElement) {
                // Ensure cornerstone is enabled or re-enabled cleanly
                try {
                    cornerstone.enable(previewElement);
                } catch (e) { }

                // Force resize to match container dimensions now that it's visible
                cornerstone.resize(previewElement, true);

                // Render
                this.updateDownloadPreview();
            }
        }, 50);
    }

    closeDownloadModal() {
        const modal = document.getElementById('download-modal');
        modal.classList.add('hidden');

        // Clean up preview element
        const previewElement = document.getElementById('preview-element');
        if (previewElement) {
            try {
                cornerstone.disable(previewElement);
            } catch (e) { }
        }
    }


    updateDownloadPreview() {
        const previewElement = document.getElementById('preview-element');
        if (!this.element || !previewElement) return;

        // Make sure it's enabled (or already enabled)
        // FORCE CLEANUP: Clear content to ensure fresh Cornerstone initialization
        // This solves the black screen on reopen issue by ensuring no stale state exists
        if (previewElement.innerHTML !== '') {
            try {
                cornerstone.disable(previewElement);
            } catch (e) { }
            previewElement.innerHTML = '';
        }

        try {
            cornerstone.enable(previewElement);
        } catch (e) {
            // Probably already enabled, which is fine
        }

        const mainEnabledElement = cornerstone.getEnabledElement(this.element);
        const image = mainEnabledElement.image;

        // Define render handler to draw overlays AFTER image is ready
        const onPreviewRendered = (e) => {
            previewElement.removeEventListener('cornerstoneimagerendered', onPreviewRendered);
            this.drawDownloadOverlays(previewElement);
        };

        // Listen for render event
        previewElement.addEventListener('cornerstoneimagerendered', onPreviewRendered);

        // 1. Display Image fitting the container
        cornerstone.displayImage(previewElement, image);

        // 2. Fit to window (container) so it looks nice
        // This calculates the correct scale/translation to fit
        cornerstone.fitToWindow(previewElement);

        // 3. Sync Window/Level from main view BUT KEEP SCALE/TRANSLATION from fitToWindow
        const previewViewport = cornerstone.getViewport(previewElement);
        const mainViewport = mainEnabledElement.viewport;

        previewViewport.voi = { ...mainViewport.voi };
        previewViewport.invert = mainViewport.invert;
        previewViewport.collation = mainViewport.collation;
        // Do NOT copy scale or translation, let fitToWindow rule.

        cornerstone.setViewport(previewElement, previewViewport);

        // 4. Force immediate update triggers render -> triggers event -> draws overlays
        cornerstone.updateImage(previewElement);

        // 5. Handle Warning Label Visibility (Visual only for preview)
        // Warning is handled by HTML overlay, safe to toggle immediately
        const includeWarning = document.getElementById('download-warning').checked;
        const warningEl = document.getElementById('preview-warning');
        if (warningEl) {
            warningEl.style.display = includeWarning ? 'block' : 'none';
        }
    }

    drawDownloadOverlays(element) {
        const includeAnnotations = document.getElementById('download-annotations').checked;
        // Even if annotations aren't checked, we might need to clear previous drawings
        // But since we redraw the image every time, canvas is cleared by cornerstone.

        if (!includeAnnotations) return;

        const canvas = element.querySelector('canvas');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const enabledElement = cornerstone.getEnabledElement(element);
        const image = enabledElement.image;

        // Setup pixel spacing logic similar to main view
        const pixelSpacing = {
            x: image.columnPixelSpacing || 1,
            y: image.rowPixelSpacing || 1,
            estimated: (!image.columnPixelSpacing || !image.rowPixelSpacing) // If info is missing
        };

        const measurementsToDraw = this.measurements.filter(m =>
            m.imageIndex === this.currentImageIndex &&
            (!m.seriesId || (this.currentSeries && m.seriesId === this.currentSeries.id))
        );
        if (this.currentMeasurement && this.currentMeasurement.imageIndex === this.currentImageIndex) {
            measurementsToDraw.push(this.currentMeasurement);
        }

        // Reset transform to ensure pixelToCanvas coordinates (which are in canvas space) map 1:1 to drawing
        // Reset transform to ensure pixelToCanvas coordinates (which are in canvas space) map 1:1 to drawing
        // HiDPI Fix: Scale context by device pixel ratio if backing store > client size
        const dpr = canvas.width / canvas.clientWidth;

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        if (dpr !== 1) {
            ctx.scale(dpr, dpr);
        }
        ctx.save();

        measurementsToDraw.forEach(m => {
            const start = cornerstone.pixelToCanvas(element, m.start);
            const end = cornerstone.pixelToCanvas(element, m.end);

            // Draw Line
            ctx.beginPath();
            ctx.strokeStyle = '#00ff00'; // Lime green
            ctx.lineWidth = 2; // Scaled? No, fixed width for visibility
            ctx.moveTo(start.x, start.y);
            ctx.lineTo(end.x, end.y);
            ctx.stroke();

            // Draw Endpoints
            ctx.fillStyle = '#00ff00';
            [start, end].forEach(p => {
                ctx.beginPath();
                ctx.arc(p.x, p.y, 3, 0, 2 * Math.PI);
                ctx.fill();
            });

            // Calculate distance
            const dx = m.end.x - m.start.x;
            const dy = m.end.y - m.start.y;
            const dxMm = dx * pixelSpacing.x;
            const dyMm = dy * pixelSpacing.y;
            const distance = Math.sqrt(dxMm * dxMm + dyMm * dyMm);

            const prefix = pixelSpacing.estimated ? '~' : '';
            const text = `${prefix}${distance.toFixed(1)} mm`;

            // Draw Text Label
            const midX = (start.x + end.x) / 2;
            const midY = (start.y + end.y) / 2;

            ctx.font = '13px Arial';
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'center';

            const textWidth = ctx.measureText(text).width + 8;

            // Background
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.fillRect(midX - textWidth / 2, midY - 12, textWidth, 24);

            // Text
            ctx.fillStyle = '#00ff00';
            ctx.fillText(text, midX, midY);
        });

        ctx.restore();
    }

    saveImage() {
        const width = parseInt(document.getElementById('download-width').value) || 1024;
        const height = parseInt(document.getElementById('download-height').value) || 1024;
        const filename = document.getElementById('download-filename').value || 'Image';
        const format = document.getElementById('download-format').value || 'jpg';
        const includeWarning = document.getElementById('download-warning').checked;

        // 1. Create a temporary off-screen container
        const tempDiv = document.createElement('div');
        tempDiv.style.width = width + 'px';
        tempDiv.style.height = height + 'px';

        // Use visible styling but off-screen to ensure browser renders it properly
        tempDiv.style.position = 'fixed'; // Fixed escapes any parent overflow
        tempDiv.style.left = '0';
        tempDiv.style.top = '0';
        tempDiv.style.zIndex = '-1000'; // Behind everything
        tempDiv.style.opacity = '0'; // Invisible but rendered
        tempDiv.style.pointerEvents = 'none';

        document.body.appendChild(tempDiv);

        try {
            // 2. Enable Cornerstone
            cornerstone.enable(tempDiv);

            const mainEnabledElement = cornerstone.getEnabledElement(this.element);
            const image = mainEnabledElement.image;

            // Define the render handler
            const onImageRendered = (e) => {
                tempDiv.removeEventListener('cornerstoneimagerendered', onImageRendered);

                setTimeout(() => {
                    try {
                        // 6. Draw Annotations on top of rendered image
                        this.drawDownloadOverlays(tempDiv);

                        // 7. Get Canvas and Context
                        const canvas = tempDiv.querySelector('canvas');
                        const ctx = canvas.getContext('2d');

                        // 8. Burn-in Warning if requested
                        if (includeWarning) {
                            ctx.save();
                            ctx.fillStyle = 'rgba(255, 0, 0, 0.4)';
                            ctx.font = 'bold 24px Arial';
                            ctx.textAlign = 'center';
                            ctx.textBaseline = 'bottom';

                            const wText = "Not For Diagnostic Use";
                            const wWidth = ctx.measureText(wText).width + 30;

                            // Background strip
                            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
                            ctx.fillRect((canvas.width / 2) - (wWidth / 2), canvas.height - 40, wWidth, 34);

                            ctx.fillStyle = '#ff4444';
                            ctx.fillText(wText, canvas.width / 2, canvas.height - 12);
                            ctx.restore();
                        }

                        // 9. Download
                        const mimeType = format === 'png' ? 'image/png' : 'image/jpeg';
                        const dataUrl = canvas.toDataURL(mimeType, 0.95);

                        const link = document.createElement('a');
                        link.download = `${filename}.${format}`;
                        link.href = dataUrl;
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);

                        this.closeDownloadModal();

                    } catch (err) {
                        console.error('Error during download processing:', err);
                        alert('Error procesando la imagen descargada.');
                    } finally {
                        try { cornerstone.disable(tempDiv); } catch (e) { }
                        if (tempDiv.parentNode) document.body.removeChild(tempDiv);
                    }
                }, 50);
            };

            // 3. Listen for render completion
            tempDiv.addEventListener('cornerstoneimagerendered', onImageRendered);

            // 4. Display logic
            cornerstone.displayImage(tempDiv, image);

            // 5. Set Viewport and Fit
            // Important: We update viewport AFTER displayImage triggers the initial setup
            // But we need to ensure updateImage is called after these changes.
            const vp = cornerstone.getViewport(tempDiv);
            vp.voi = { ...mainEnabledElement.viewport.voi };
            vp.invert = mainEnabledElement.viewport.invert;
            cornerstone.setViewport(tempDiv, vp);

            cornerstone.fitToWindow(tempDiv);

            // Force Update to trigger render and event
            cornerstone.updateImage(tempDiv);

        } catch (e) {
            console.error('Error initiating download:', e);
            document.body.removeChild(tempDiv);
        }
    }

    openAboutModal() {
        const modal = document.getElementById('about-modal');
        const browserInfo = document.getElementById('browser-info');

        // Detect browser and OS
        const ua = navigator.userAgent;
        let browser = 'Desconocido';
        let os = 'Desconocido';

        // Browser detection
        if (ua.includes('Chrome') && !ua.includes('Edg')) {
            const match = ua.match(/Chrome\/(\d+)/);
            browser = `Chrome ${match ? match[1] : ''}`;
        } else if (ua.includes('Firefox')) {
            const match = ua.match(/Firefox\/(\d+)/);
            browser = `Firefox ${match ? match[1] : ''}`;
        } else if (ua.includes('Safari') && !ua.includes('Chrome')) {
            const match = ua.match(/Version\/(\d+)/);
            browser = `Safari ${match ? match[1] : ''}`;
        } else if (ua.includes('Edg')) {
            const match = ua.match(/Edg\/(\d+)/);
            browser = `Edge ${match ? match[1] : ''}`;
        }

        // OS detection
        if (ua.includes('Mac OS')) {
            const match = ua.match(/Mac OS X (\d+[._]\d+)/);
            os = `macOS ${match ? match[1].replace('_', '.') : ''}`;
        } else if (ua.includes('Windows')) {
            os = 'Windows';
        } else if (ua.includes('Linux')) {
            os = 'Linux';
        }

        browserInfo.textContent = `${browser}, ${os}`;
        modal.classList.remove('hidden');
    }

    closeAboutModal() {
        document.getElementById('about-modal').classList.add('hidden');
    }

    setupViewportEvents() {
        const container = document.getElementById('dicom-viewport');

        let isDragging = false;
        let lastPos = { x: 0, y: 0 };

        container.addEventListener('mousedown', (e) => {
            if (!this.element) return;

            // Handle measurement tool
            if (this.activeTool === 'length') {
                const rect = this.element.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                const imagePoint = cornerstone.pageToPixel(this.element, e.pageX, e.pageY);

                if (!this.isDrawingMeasurement) {
                    this.isDrawingMeasurement = true;
                    this.measurementStart = imagePoint;
                    this.currentMeasurement = {
                        start: imagePoint,
                        end: imagePoint,
                        imageIndex: this.currentImageIndex,
                        seriesId: this.currentSeries ? this.currentSeries.id : null
                    };
                }
                return;
            }

            isDragging = true;
            lastPos = { x: e.clientX, y: e.clientY };
        });

        container.addEventListener('mousemove', (e) => {
            if (!this.element) return;

            // Handle measurement drawing
            if (this.activeTool === 'length' && this.isDrawingMeasurement) {
                const imagePoint = cornerstone.pageToPixel(this.element, e.pageX, e.pageY);
                this.currentMeasurement.end = imagePoint;
                this.drawMeasurements();
                return;
            }

            if (!isDragging) return;

            const dx = e.clientX - lastPos.x;
            const dy = e.clientY - lastPos.y;
            lastPos = { x: e.clientX, y: e.clientY };

            const viewport = cornerstone.getViewport(this.element);
            if (!viewport) return;

            if (this.activeTool === 'stackscroll') {
                // Stack scroll: navigate images based on vertical movement
                if (!this.stackScrollAccumulator) this.stackScrollAccumulator = 0;
                this.stackScrollAccumulator += dy;

                // Threshold for changing image (pixels of movement needed)
                const threshold = 30;

                if (Math.abs(this.stackScrollAccumulator) >= threshold) {
                    const direction = this.stackScrollAccumulator > 0 ? 1 : -1;
                    this.navigate(direction);
                    this.stackScrollAccumulator = 0;
                }
            } else if (this.activeTool === 'wwwc') {
                viewport.voi.windowWidth += dx * 2;
                viewport.voi.windowCenter += dy;
                cornerstone.setViewport(this.element, viewport);

                const wcEl = document.getElementById('wc-value');
                const wwEl = document.getElementById('ww-value');
                if (wcEl) wcEl.textContent = viewport.voi.windowCenter.toFixed(0);
                if (wwEl) wwEl.textContent = viewport.voi.windowWidth.toFixed(0);
            } else if (this.activeTool === 'pan') {
                viewport.translation.x += dx;
                viewport.translation.y += dy;
                cornerstone.setViewport(this.element, viewport);
            } else if (this.activeTool === 'zoom') {
                viewport.scale += dy * 0.01;
                viewport.scale = Math.max(0.1, Math.min(10, viewport.scale));
                cornerstone.setViewport(this.element, viewport);
            }
        });

        container.addEventListener('mouseup', (e) => {
            // Finish measurement
            if (this.activeTool === 'length' && this.isDrawingMeasurement) {
                const imagePoint = cornerstone.pageToPixel(this.element, e.pageX, e.pageY);
                this.currentMeasurement.end = imagePoint;
                this.measurements.push({ ...this.currentMeasurement });
                this.isDrawingMeasurement = false;
                this.currentMeasurement = null;
                this.drawMeasurements();
                return;
            }
            isDragging = false;
            this.stackScrollAccumulator = 0;
        });

        container.addEventListener('mouseleave', () => {
            isDragging = false;
            this.stackScrollAccumulator = 0;
        });

        // Mouse wheel/trackpad for controlled image scrolling
        this.wheelAccumulator = 0;
        this.isWheelScrolling = false;
        this.wheelScrollTimeout = null;
        const scrollDelay = 30; // Very fast image transitions
        const trackpadThreshold = 150; // Higher threshold to prevent skipping

        container.addEventListener('wheel', (e) => {
            if (!this.imageIds.length) return;
            e.preventDefault();

            // Completely ignore scroll events during blocking period
            if (this.isWheelScrolling) return;

            // Accumulate delta
            this.wheelAccumulator += e.deltaY;

            // Only change image if accumulated enough delta
            if (Math.abs(this.wheelAccumulator) >= trackpadThreshold) {
                const direction = this.wheelAccumulator > 0 ? 1 : -1;
                this.navigate(direction);

                // Reset and block further changes
                this.wheelAccumulator = 0;
                this.isWheelScrolling = true;
                clearTimeout(this.wheelScrollTimeout);
                this.wheelScrollTimeout = setTimeout(() => {
                    this.isWheelScrolling = false;
                    this.wheelAccumulator = 0;
                }, scrollDelay);
            }
        }, { passive: false });
    }

    drawMeasurements() {
        if (!this.element) return;

        // Get or create the SVG overlay
        let svg = this.element.querySelector('.measurement-overlay');
        if (!svg) {
            svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.classList.add('measurement-overlay');
            svg.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 10;';
            this.element.appendChild(svg);
        }

        svg.innerHTML = '';

        // Get pixel spacing from current image for accurate measurement
        const pixelSpacing = this.getPixelSpacing();

        // Draw all measurements for current image
        // Draw all measurements for current image AND current series
        const measurementsToDraw = this.measurements.filter(m =>
            m.imageIndex === this.currentImageIndex &&
            (!m.seriesId || (this.currentSeries && m.seriesId === this.currentSeries.id))
        );

        // Add current measurement being drawn
        if (this.currentMeasurement && this.currentMeasurement.imageIndex === this.currentImageIndex) {
            measurementsToDraw.push(this.currentMeasurement);
        }

        measurementsToDraw.forEach(measurement => {
            const start = cornerstone.pixelToCanvas(this.element, measurement.start);
            const end = cornerstone.pixelToCanvas(this.element, measurement.end);

            // Draw line
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', start.x);
            line.setAttribute('y1', start.y);
            line.setAttribute('x2', end.x);
            line.setAttribute('y2', end.y);
            line.setAttribute('stroke', '#00ff00');
            line.setAttribute('stroke-width', '2');
            svg.appendChild(line);

            // Draw endpoints
            [start, end].forEach(point => {
                const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle.setAttribute('cx', point.x);
                circle.setAttribute('cy', point.y);
                circle.setAttribute('r', '4');
                circle.setAttribute('fill', '#00ff00');
                svg.appendChild(circle);
            });

            // Calculate distance in mm
            const dx = measurement.end.x - measurement.start.x;
            const dy = measurement.end.y - measurement.start.y;
            const dxMm = dx * pixelSpacing.x;
            const dyMm = dy * pixelSpacing.y;
            const distance = Math.sqrt(dxMm * dxMm + dyMm * dyMm);

            // Show ~ prefix if using estimated pixel spacing
            const prefix = pixelSpacing.estimated ? '~' : '';
            const displayText = `${prefix}${distance.toFixed(1)} mm`;

            // Draw text label
            const midX = (start.x + end.x) / 2;
            const midY = (start.y + end.y) / 2;

            // Calculate text width for background
            const textWidth = displayText.length * 7 + 10;

            // Background for text
            const textBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            textBg.setAttribute('x', midX - textWidth / 2);
            textBg.setAttribute('y', midY - 20);
            textBg.setAttribute('width', textWidth);
            textBg.setAttribute('height', '18');
            textBg.setAttribute('fill', 'rgba(0,0,0,0.7)');
            textBg.setAttribute('rx', '3');
            svg.appendChild(textBg);

            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', midX);
            text.setAttribute('y', midY - 7);
            text.setAttribute('fill', pixelSpacing.estimated ? '#ffcc00' : '#00ff00');
            text.setAttribute('font-size', '12');
            text.setAttribute('font-family', 'Arial, sans-serif');
            text.setAttribute('text-anchor', 'middle');
            text.textContent = displayText;
            svg.appendChild(text);

            // Add delete button (X) if it's not the current measurement being drawn
            if (measurement !== this.currentMeasurement) {
                const deleteBtnGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                deleteBtnGroup.style.cursor = 'pointer';
                deleteBtnGroup.style.pointerEvents = 'all'; // Enable clicks on this group

                const btnX = midX + textWidth / 2 + 10;
                const btnY = midY - 11;

                const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle.setAttribute('cx', btnX);
                circle.setAttribute('cy', btnY);
                circle.setAttribute('r', '8');
                circle.setAttribute('fill', '#ff4444');
                circle.setAttribute('stroke', '#fff');
                circle.setAttribute('stroke-width', '1');

                const xMark = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                xMark.setAttribute('x', btnX);
                xMark.setAttribute('y', btnY + 3);
                xMark.setAttribute('text-anchor', 'middle');
                xMark.setAttribute('fill', '#fff');
                xMark.setAttribute('font-size', '10');
                xMark.setAttribute('font-weight', 'bold');
                xMark.setAttribute('font-family', 'Arial, sans-serif');
                xMark.textContent = '×';

                deleteBtnGroup.appendChild(circle);
                deleteBtnGroup.appendChild(xMark);

                // Add click event to remove this specific measurement
                deleteBtnGroup.addEventListener('mousedown', (e) => {
                    e.stopPropagation(); // Prevent starting a new tool action
                    this.removeMeasurement(measurement);
                });

                svg.appendChild(deleteBtnGroup);
            }
        });
    }

    getPixelSpacing() {
        try {
            // Try to get from loaded image
            const enabledElement = cornerstone.getEnabledElement(this.element);
            if (enabledElement && enabledElement.image) {
                const image = enabledElement.image;

                // Method 1: Check rowPixelSpacing and columnPixelSpacing (set by cornerstone)
                if (image.rowPixelSpacing && image.columnPixelSpacing) {
                    return {
                        y: image.rowPixelSpacing,
                        x: image.columnPixelSpacing
                    };
                }

                // Method 2: Get from DICOM data directly
                if (image.data && image.data.string) {
                    // Try Pixel Spacing (0028,0030)
                    let pixelSpacingStr = image.data.string('x00280030');

                    // If not found, try Imager Pixel Spacing (0018,1164) - common in X-ray/mammography
                    if (!pixelSpacingStr) {
                        pixelSpacingStr = image.data.string('x00181164');
                    }

                    if (pixelSpacingStr) {
                        const parts = pixelSpacingStr.split('\\');
                        if (parts.length >= 2) {
                            const rowSpacing = parseFloat(parts[0]);
                            const colSpacing = parseFloat(parts[1]);
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

        // Return a default value of 1mm per pixel if no calibration data available
        // This allows measurements but shows a warning
        return { x: 1, y: 1, estimated: true };
    }

    removeMeasurement(measurementToRemove) {
        this.measurements = this.measurements.filter(m => m !== measurementToRemove);
        this.drawMeasurements();
    }

    clearMeasurements() {
        // Only clear measurements for current image of current series
        this.measurements = this.measurements.filter(m =>
            !(m.imageIndex === this.currentImageIndex &&
                (!m.seriesId || (this.currentSeries && m.seriesId === this.currentSeries.id)))
        );
        this.drawMeasurements();
    }

    resetWheelScroll() {
        this.wheelAccumulator = 0;
        this.isWheelScrolling = false;
        if (this.wheelScrollTimeout) {
            clearTimeout(this.wheelScrollTimeout);
            this.wheelScrollTimeout = null;
        }
    }

    setTool(tool) {
        this.activeTool = tool;
        document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
        document.getElementById(`tool-${tool}`).classList.add('active');
    }

    resetView() {
        if (!this.element) return;
        cornerstone.reset(this.element);
        const viewport = cornerstone.getViewport(this.element);
        if (viewport) {
            const wcEl = document.getElementById('wc-value');
            const wwEl = document.getElementById('ww-value');
            if (wcEl) wcEl.textContent = viewport.voi.windowCenter.toFixed(0);
            if (wwEl) wwEl.textContent = viewport.voi.windowWidth.toFixed(0);
        }
        // Clear measurements for current image
        this.clearMeasurements();
    }

    navigate(direction) {
        if (!this.imageIds.length) return;

        const newIndex = this.currentImageIndex + direction;
        if (newIndex >= 0 && newIndex < this.imageIds.length) {
            this.loadImage(newIndex, direction);
        }
    }

    updateNavigation() {
        const total = this.imageIds.length;
        const stackScrollBtn = document.getElementById('tool-stackscroll');
        const imageScrollbar = document.getElementById('image-scrollbar');
        const scrollbarThumb = document.getElementById('scrollbar-thumb');

        if (total === 0) {
            document.getElementById('image-counter').textContent = 'Reporte';
            document.getElementById('prev-image').disabled = true;
            document.getElementById('next-image').disabled = true;
            if (stackScrollBtn) {
                stackScrollBtn.disabled = true;
                stackScrollBtn.title = 'Scroll de Imágenes (no disponible)';
            }
            if (imageScrollbar) {
                imageScrollbar.classList.add('hidden');
            }
        } else if (total === 1) {
            document.getElementById('image-counter').textContent = `${this.currentImageIndex + 1} / ${total}`;
            document.getElementById('prev-image').disabled = true;
            document.getElementById('next-image').disabled = true;
            if (stackScrollBtn) {
                stackScrollBtn.disabled = true;
                stackScrollBtn.title = 'Scroll de Imágenes (solo 1 imagen)';
            }
            if (imageScrollbar) {
                imageScrollbar.classList.add('hidden');
            }
        } else {
            document.getElementById('image-counter').textContent = `${this.currentImageIndex + 1} / ${total}`;
            document.getElementById('prev-image').disabled = this.currentImageIndex <= 0;
            document.getElementById('next-image').disabled = this.currentImageIndex >= total - 1;
            if (stackScrollBtn) {
                stackScrollBtn.disabled = false;
                stackScrollBtn.title = 'Scroll de Imágenes - Navega con click sostenido';
            }

            // Show and update image scrollbar
            if (imageScrollbar && scrollbarThumb) {
                imageScrollbar.classList.remove('hidden');

                // Calculate thumb size and position
                const thumbHeight = Math.max(8, 100 / total); // Percentage height
                const thumbPosition = (this.currentImageIndex / (total - 1)) * (100 - thumbHeight);

                scrollbarThumb.style.height = `${thumbHeight}%`;
                scrollbarThumb.style.top = `${thumbPosition}%`;
            }
        }
    }

    setupScrollbarEvents() {
        const scrollbar = document.getElementById('image-scrollbar');
        const track = scrollbar?.querySelector('.scrollbar-track');
        const thumb = document.getElementById('scrollbar-thumb');

        if (!track || !thumb) return;

        let isDraggingThumb = false;

        // Click on track to jump to position
        track.addEventListener('click', (e) => {
            if (isDraggingThumb) return;
            if (!this.imageIds.length || this.imageIds.length <= 1) return;

            const rect = track.getBoundingClientRect();
            const clickY = e.clientY - rect.top;
            const percentage = clickY / rect.height;
            const newIndex = Math.round(percentage * (this.imageIds.length - 1));

            if (newIndex >= 0 && newIndex < this.imageIds.length && newIndex !== this.currentImageIndex) {
                this.loadImage(newIndex);
            }
        });

        // Drag thumb
        thumb.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            isDraggingThumb = true;
            document.body.style.cursor = 'grabbing';
            document.body.style.userSelect = 'none';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDraggingThumb) return;
            if (!this.imageIds.length || this.imageIds.length <= 1) return;

            const rect = track.getBoundingClientRect();
            const mouseY = e.clientY - rect.top;
            const percentage = Math.max(0, Math.min(1, mouseY / rect.height));
            const newIndex = Math.round(percentage * (this.imageIds.length - 1));

            if (newIndex >= 0 && newIndex < this.imageIds.length && newIndex !== this.currentImageIndex) {
                this.loadImage(newIndex);
            }
        });

        document.addEventListener('mouseup', () => {
            if (isDraggingThumb) {
                isDraggingThumb = false;
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            }
        });
    }
}

// Initialize viewer when DOM is ready
window.addEventListener('DOMContentLoaded', () => {
    window.viewer = new DicomViewer();
});
