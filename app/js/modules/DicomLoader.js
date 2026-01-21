/**
 * DicomLoader - Module for handling DICOM file loading and organization
 * Part of EDX Viewer Lite
 */
var DicomLoader = (function () {
    'use strict';

    /**
     * Creates a new DicomLoader instance
     * @param {DicomViewer} viewer - Reference to the main viewer instance
     */
    function DicomLoader(viewer) {
        this.viewer = viewer;
    }

    /**
     * Sets up drag and drop zone for file loading
     */
    DicomLoader.prototype.setupDropZone = function () {
        var self = this;
        var dropZone = document.getElementById('drop-zone');
        var viewport = document.getElementById('dicom-viewport');

        // Prevent default drag behaviors on the whole document
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(function (eventName) {
            document.body.addEventListener(eventName, function (e) {
                e.preventDefault();
                e.stopPropagation();
            });
        });

        // Drag and drop events on viewport
        ['dragenter', 'dragover'].forEach(function (eventName) {
            viewport.addEventListener(eventName, function () {
                if (dropZone) dropZone.classList.add('drag-over');
            });
        });

        ['dragleave', 'drop'].forEach(function (eventName) {
            viewport.addEventListener(eventName, function () {
                if (dropZone) dropZone.classList.remove('drag-over');
            });
        });

        viewport.addEventListener('drop', async function (e) {
            console.log('Drop event fired');

            // Try to get files from dataTransfer.items first (for folder support)
            if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
                var items = e.dataTransfer.items;
                var hasWebkitEntry = items[0] && items[0].webkitGetAsEntry;

                if (hasWebkitEntry) {
                    await self.handleDroppedItems(items);
                    return;
                }
            }

            // Fallback: use dataTransfer.files directly
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                console.log('Using files fallback:', e.dataTransfer.files.length, 'files');
                self.handleFiles(Array.from(e.dataTransfer.files));
            }
        });

        // Folder button
        document.getElementById('btn-load-folder').addEventListener('click', function () {
            document.getElementById('folder-input').click();
        });

        // Folder input
        document.getElementById('folder-input').addEventListener('change', function (e) {
            if (e.target.files.length > 0) {
                self.handleFiles(Array.from(e.target.files));
            }
        });
    };

    /**
     * Handles dropped items (files or directories)
     * @param {DataTransferItemList} items - Dropped items
     */
    DicomLoader.prototype.handleDroppedItems = async function (items) {
        var self = this;
        console.log('handleDroppedItems called with', items.length, 'items');
        var files = [];

        // Helper to read ALL entries from a directory
        var readAllDirectoryEntries = async function (dirReader) {
            var entries = [];
            var batch = await new Promise(function (resolve, reject) {
                dirReader.readEntries(resolve, reject);
            });

            while (batch.length > 0) {
                entries.push.apply(entries, batch);
                batch = await new Promise(function (resolve, reject) {
                    dirReader.readEntries(resolve, reject);
                });
            }
            return entries;
        };

        var traverseFileTree = async function (entry, path) {
            path = path || '';
            if (entry.isFile) {
                try {
                    var file = await new Promise(function (resolve, reject) {
                        entry.file(resolve, reject);
                    });
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
                    var dirReader = entry.createReader();
                    var entries = await readAllDirectoryEntries(dirReader);
                    console.log('Directory "' + entry.name + '" has ' + entries.length + ' entries');

                    for (var i = 0; i < entries.length; i++) {
                        await traverseFileTree(entries[i], path + entry.name + '/');
                    }
                } catch (err) {
                    console.warn('Error reading directory:', entry.name, err);
                }
            }
        };

        // Process all dropped items
        for (var i = 0; i < items.length; i++) {
            var entry = items[i].webkitGetAsEntry();
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
    };

    /**
     * Handles file array, filters DICOM files and initiates parsing
     * @param {File[]} files - Array of files
     */
    DicomLoader.prototype.handleFiles = async function (files) {
        var self = this;

        // Filter DICOM files
        var dicomFiles = files.filter(function (file) {
            var name = file.name.toLowerCase();
            return name.endsWith('.dcm') || !name.includes('.');
        });

        if (dicomFiles.length === 0) {
            alert('No se encontraron archivos DICOM válidos');
            return;
        }

        // Parse and organize files
        await this.parseAndOrganizeFiles(dicomFiles);
        this.viewer.ui.renderStudiesList();

        // Automatically open the first series
        if (this.viewer.studies.length > 0) {
            var firstStudy = this.viewer.studies[0];
            var seriesIds = Object.keys(firstStudy.series);
            if (seriesIds.length > 0) {
                var firstSeriesId = seriesIds[0];

                // Expand the series list dropdown
                var seriesList = document.getElementById('series-0');
                if (seriesList) {
                    seriesList.classList.add('expanded');
                }

                // Mark the first series as active
                var firstSeriesElement = document.querySelector('#series-0 .series-item');
                if (firstSeriesElement) {
                    firstSeriesElement.classList.add('active');
                }

                // Load the first series
                await this.viewer.selectSeriesDirectly(0, firstSeriesId);
            }
        }
    };

    /**
     * Parses DICOM files and organizes them by study/series
     * @param {File[]} files - Array of DICOM files
     */
    DicomLoader.prototype.parseAndOrganizeFiles = async function (files) {
        var self = this;
        this.viewer.studies = [];
        var studiesMap = {};

        for (var i = 0; i < files.length; i++) {
            var file = files[i];
            try {
                var arrayBuffer = await file.arrayBuffer();
                var dataSet = dicomParser.parseDicom(new Uint8Array(arrayBuffer));

                // Extract metadata
                var studyUID = dataSet.string('x0020000d') || 'UnknownStudy';
                var seriesUID = dataSet.string('x0020000e') || 'UnknownSeries';
                var studyDescription = dataSet.string('x00081030') || 'Estudio';
                var seriesDescription = dataSet.string('x0008103e') || '';
                var modality = dataSet.string('x00080060') || 'OT';
                var instanceNumber = parseInt(dataSet.string('x00200013')) || 0;

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
                var imageId = cornerstoneWADOImageLoader.wadouri.fileManager.add(file);
                this.viewer.fileMap.set(imageId, file);

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
        for (var studyUID in studiesMap) {
            for (var seriesUID in studiesMap[studyUID].series) {
                studiesMap[studyUID].series[seriesUID].images.sort(function (a, b) {
                    return a.instanceNumber - b.instanceNumber;
                });
            }
        }

        this.viewer.studies = Object.values(studiesMap);
    };

    return DicomLoader;
})();
