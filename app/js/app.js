/**
 * EDX DICOM Viewer - Main Application
 * Modular Architecture with IIFE Pattern
 * @version 1.1.0
 */

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

/**
 * DicomViewer - Main orchestrator class
 * Coordinates all modules and maintains shared state
 */
var DicomViewer = (function () {
    'use strict';

    function DicomViewer() {
        // Shared state
        this.studies = [];
        this.currentSeries = null;
        this.currentImageIndex = 0;
        this.element = null;
        this.activeTool = 'wwwc';
        this.imageIds = [];
        this.fileMap = new Map();
        this.viewportInitialized = false;

        // Initialize modules
        this.loader = new DicomLoader(this);
        this.measurement = new MeasurementTool(this);
        this.exporter = new ImageExporter(this);
        this.viewport = new ViewportManager(this);
        this.ui = new UIController(this);

        this.init();
    }

    /**
     * Initializes the viewer
     */
    DicomViewer.prototype.init = function () {
        this.ui.setupEventListeners();
        this.loader.setupDropZone();
        this.ui.setupScrollbarEvents();
    };

    /**
     * Selects a series directly by index and ID
     * @param {number} studyIdx - Study index
     * @param {string} seriesId - Series ID
     */
    DicomViewer.prototype.selectSeriesDirectly = async function (studyIdx, seriesId) {
        var study = this.studies[studyIdx];
        var series = study.series[seriesId];

        this.currentSeries = series;
        this.currentImageIndex = 0;

        // Reset wheel scroll state
        this.ui.resetWheelScroll();

        // Check if this is a Structured Report series
        if (series.modality === 'SR') {
            this.viewportInitialized = false;
            await this.viewport.loadStructuredReport(series);
            return;
        }

        // Initialize viewport
        this.viewport.setupViewport();

        // Create image IDs array
        this.imageIds = series.images.map(function (img) { return img.imageId; });
        this.viewport.invalidImageIndices = new Set();

        // Load first valid image
        await this.viewport.loadFirstValidImage();
        this.ui.updateNavigation();
    };

    /**
     * Opens the download modal (facade for exporter)
     */
    DicomViewer.prototype.openDownloadModal = function () {
        this.exporter.openDownloadModal();
    };

    /**
     * Closes the download modal (facade for exporter)
     */
    DicomViewer.prototype.closeDownloadModal = function () {
        this.exporter.closeDownloadModal();
    };

    /**
     * Updates the download preview (facade for exporter)
     */
    DicomViewer.prototype.updateDownloadPreview = function () {
        this.exporter.updateDownloadPreview();
    };

    /**
     * Saves the image (facade for exporter)
     */
    DicomViewer.prototype.saveImage = function () {
        this.exporter.saveImage();
    };

    return DicomViewer;
})();

// Create global viewer instance when DOM is ready
var viewer;
document.addEventListener('DOMContentLoaded', function () {
    viewer = new DicomViewer();
});
