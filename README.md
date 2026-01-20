# EDX DICOM Viewer

<p align="center">
  <img src="app/images/logo-edx-white.png" alt="EDX Logo" width="200">
</p>

![Versión](https://img.shields.io/badge/versión-1.0.0-blue?style=for-the-badge)
![Licencia](https://img.shields.io/badge/licencia-GPL--3.0-green?style=for-the-badge)

**Visor de imágenes médicas DICOM 100% basado en web (client-side).** Funciona abriendo directamente `visor.html` en un navegador sin necesidad de servidor ni instalación.

> ⚠️ **Aviso:** Este software es solo para uso académico e investigación. No está destinado ni autorizado para diagnóstico médico.

## 📌 Versión Actual

| Versión | Fecha | Notas |
|---------|-------|-------|
| **1.0.0** | Enero 2026 | Versión inicial con carga de archivos, herramientas de visualización (Pan, Zoom, W/L, Medir) y soporte para Structured Reports |

## 🌐 Navegadores Compatibles

| Navegador | Versión Mínima | Estado |
|-----------|----------------|--------|
| ![Chrome](https://img.shields.io/badge/Chrome-80+-4285F4?logo=googlechrome&logoColor=white) | 80+ | ✅ Recomendado |
| ![Firefox](https://img.shields.io/badge/Firefox-75+-FF7139?logo=firefox&logoColor=white) | 75+ | ✅ Compatible |
| ![Safari](https://img.shields.io/badge/Safari-13+-000000?logo=safari&logoColor=white) | 13+ | ✅ Compatible |
| ![Edge](https://img.shields.io/badge/Edge-80+-0078D7?logo=microsoftedge&logoColor=white) | 80+ | ✅ Compatible |

> **Nota:** Se recomienda usar **Google Chrome** para la mejor experiencia de usuario. El visor requiere un navegador moderno con soporte para ES6+, Web Workers y la API File System Access.

## 🚀 Características

- **📂 Carga de archivos**: Botón "Cargar Carpeta DICOM" para seleccionar carpetas con archivos DICOM
- **🗂️ Organización automática**: Los archivos se organizan por Study UID y Series UID
- **🖼️ Visualización de imágenes**: Renderizado de alta calidad con Cornerstone.js
- **🔧 Herramientas de manipulación**:
  - Pan (Mover imagen)
  - Zoom
  - Window/Level (Brillo/Contraste)
  - **Medir** (Regla para medir distancias en mm)
  - **Stack Scroll**: Navegación optimizada para mouse y trackpad con sensibilidad ajustada para evitar saltos.
  - Reset
- **🔀 Navegación Avanzada**:
  - Rueda del ratón / Trackpad (controlado y sin saltos)
  - **Barra de Scroll Lateral**: Indicador visual y control de arrastre en el lado derecho
  - Botones Anterior/Siguiente
- **📋 Metadatos**: Panel derecho con información del paciente, estudio e imagen
- **📄 Reportes SR**: Visualización de Structured Reports como texto
- **ℹ️ Información del Sistema**: Modal "Acerca de" con detección automática de versión de navegador y SO
- **📖 Instrucciones**: Panel central con guía de uso paso a paso

## 🛠️ Tecnologías Utilizadas

| Tecnología | Versión | Descripción |
|------------|---------|-------------|
| HTML5 / CSS3 / JavaScript | - | Frontend vanilla |
| [Cornerstone Core](https://github.com/cornerstonejs/cornerstone) | 2.6.1 | Renderizado de imágenes |
| [Cornerstone Tools](https://github.com/cornerstonejs/cornerstoneTools) | 6.0.10 | Herramientas de interacción |
| [Cornerstone WADO Image Loader](https://github.com/cornerstonejs/cornerstoneWADOImageLoader) | 4.13.2 | Carga de archivos DICOM |
| [Dicom Parser](https://github.com/cornerstonejs/dicomParser) | 1.8.21 | Extracción de metadatos |
| [Font Awesome](https://fontawesome.com/) | 6.5.1 | Iconos |

## 📁 Estructura del Proyecto

```
EDX Viewer/
├── visor.html                  # Página principal
├── app/
│   ├── js/app.js               # Lógica de la aplicación
│   ├── css/styles.css          # Estilos CSS
│   └── images/logo-edx-white.png # Logo de la empresa
├── README.md                   # Este archivo
├── LICENSE                     # Licencia GPL-3.0
└── DICOM/                      # Carpeta de ejemplo con archivos DICOM
```

## 🚦 Cómo Usar

1. **Abrir** `visor.html` directamente en Chrome, Firefox o Safari
2. **Hacer clic** en el botón "Cargar Carpeta DICOM"
3. **Seleccionar** una carpeta con archivos `.dcm`
4. **Hacer clic** en una serie del panel izquierdo para visualizar las imágenes

## ⚠️ Limitaciones Conocidas

- El **drag-and-drop** de carpetas no funciona con el protocolo `file://` debido a restricciones de seguridad del navegador
- Se debe usar el botón **"Cargar Carpeta DICOM"** para cargar estudios

## 🤝 Contribuir

¡Las contribuciones son bienvenidas! Si deseas contribuir:

1. Haz un Fork del repositorio
2. Crea una rama para tu feature (`git checkout -b feature/NuevaFuncionalidad`)
3. Commit tus cambios (`git commit -m 'Añadir nueva funcionalidad'`)
4. Push a la rama (`git push origin feature/NuevaFuncionalidad`)
5. Abre un Pull Request

## 📄 Licencia

Este proyecto está licenciado bajo la **GNU General Public License v3.0 (GPL-3.0)** - ver el archivo [LICENSE](LICENSE) para más detalles.

Este software es libre: puedes redistribuirlo y/o modificarlo bajo los términos de la GNU General Public License publicada por la Free Software Foundation.

---

<p align="center">
  Desarrollado con ❤️ por <strong>EDX</strong>
</p>
