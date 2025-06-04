const NodeWebcam = require('node-webcam');
const sharp = require('sharp');
const sharpBmp = require('sharp-bmp');
const fs = require('fs');
const path = require('path');

class CameraCapture {
    constructor() {
        this.camera = null;
        this.tempDir = path.join(__dirname, '../temp');
        this.ensureTempDir();
        this.initializeCamera();
    }
    
    ensureTempDir() {
        if (!fs.existsSync(this.tempDir)) {
            fs.mkdirSync(this.tempDir, { recursive: true });
            console.log('Directorio temporal creado:', this.tempDir);
        }
    }
    
    initializeCamera() {
        // Configuración de la cámara
        const opts = {
            width: 1280,
            height: 720,
            quality: 100,
            delay: 0,
            saveShots: true,
            output: "jpeg",
            device: false, // false = cámara por defecto
            callbackReturn: "location",
            verbose: false // Reducir logs de node-webcam
        };
        
        try {
            this.camera = NodeWebcam.create(opts);
            console.log('Cámara USB inicializada');
            
            // Test inicial para verificar que la cámara funciona
            this.testCamera();
        } catch (error) {
            console.error('Error en inicialización de cámara:', error);
            this.camera = null;
        }
    }
    
    async testCamera() {
        try {
            console.log('Realizando test inicial de cámara...');
            const testImage = await this.captureTestImage();
            if (testImage) {
                console.log('✅ Test de cámara exitoso');
            }
        } catch (error) {
            console.error('❌ Test de cámara falló:', error.message);
        }
    }
    
    async captureTestImage() {
        return new Promise((resolve, reject) => {
            const testFileName = `test_${Date.now()}.jpg`;
            const testFilePath = path.join(this.tempDir, testFileName);
            
            this.camera.capture(testFilePath, (err, data) => {
                if (err) {
                    reject(new Error(`Error de cámara test: ${err.message}`));
                    return;
                }
                
                // Verificar que el archivo existe y no está vacío
                if (fs.existsSync(testFilePath)) {
                    const stats = fs.statSync(testFilePath);
                    if (stats.size > 0) {
                        this.cleanupTempFile(testFilePath);
                        resolve(true);
                    } else {
                        this.cleanupTempFile(testFilePath);
                        reject(new Error('Archivo de test vacío'));
                    }
                } else {
                    reject(new Error('Archivo de test no fue creado'));
                }
            });
        });
    }
    
    async captureImage672x672() {
        if (!this.camera) {
            throw new Error('Cámara no inicializada');
        }
        
        return new Promise((resolve, reject) => {
            const tempFileName = `capture_${Date.now()}.jpg`;
            const tempFilePath = path.join(this.tempDir, tempFileName);
            
            console.log('=== INICIANDO CAPTURA ===');
            console.log('Archivo temporal:', tempFilePath);
            
            // Capturar imagen
            this.camera.capture(tempFilePath, async (err, data) => {
                if (err) {
                    console.error('❌ Error capturando imagen:', err);
                    reject(new Error(`Error de cámara: ${err.message}`));
                    return;
                }
                
                console.log('✅ Captura completada. Data recibida:', data);
                
                try {
                    // VALIDACIÓN del archivo temporal
                    if (!fs.existsSync(tempFilePath)) {
                        throw new Error(`Archivo temporal no existe: ${tempFilePath}`);
                    }
                    
                    const stats = fs.statSync(tempFilePath);
                    console.log(`📊 Estadísticas del archivo: ${stats.size} bytes`);
                    
                    if (stats.size === 0) {
                        throw new Error('Archivo temporal vacío (0 bytes)');
                    }
                    
                    // DETECTAR formato del archivo
                    const buffer = fs.readFileSync(tempFilePath);
                    console.log(`📄 Primeros bytes: ${buffer.slice(0, 4).toString('hex')}`);
                    
                    let sharpInstance;
                    
                    // MANEJAR DIFERENTES FORMATOS
                    if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xD8) {
                        // JPEG válido (FF D8)
                        console.log('✅ Archivo JPEG detectado');
                        sharpInstance = sharp(tempFilePath);
                        
                    } else if (buffer.length >= 2 && buffer[0] === 0x42 && buffer[1] === 0x4D) {
                        // BMP (42 4D = "BM") - USAR sharp-bmp
                        console.log('🔄 Archivo BMP detectado, usando sharp-bmp...');
                        
                        try {
                            // CONVERTIR BMP usando sharp-bmp
                            sharpInstance = sharpBmp.sharpFromBmp(tempFilePath);
                            console.log('✅ BMP procesado con sharp-bmp');
                            
                        } catch (bmpError) {
                            console.error('Error con sharp-bmp:', bmpError.message);
                            throw new Error(`Error procesando BMP: ${bmpError.message}`);
                        }
                        
                    } else if (buffer.length >= 8 && 
                              buffer[0] === 0x89 && buffer[1] === 0x50 && 
                              buffer[2] === 0x4E && buffer[3] === 0x47) {
                        // PNG (89 50 4E 47 = "‰PNG")
                        console.log('✅ Archivo PNG detectado');
                        sharpInstance = sharp(tempFilePath);
                        
                    } else {
                        // Formato desconocido - intentar como sharp normal
                        console.log('⚠️ Formato desconocido, intentando procesamiento directo...');
                        sharpInstance = sharp(tempFilePath);
                    }
                    
                    // REDIMENSIONAR a 672x672
                    console.log('🔄 Redimensionando a 672x672...');
                    const resizedBuffer = await sharpInstance
                        .resize(672, 672, {
                            fit: 'cover', // Crop center manteniendo aspecto
                            position: 'center'
                        })
                        .jpeg({ quality: 80 })
                        .toBuffer();
                    
                    console.log(`✅ Redimensión completada. Tamaño final: ${resizedBuffer.length} bytes`);
                    
                    // Convertir a base64
                    const base64Image = resizedBuffer.toString('base64');
                    console.log(`📦 Base64 generado. Longitud: ${base64Image.length} caracteres`);
                    
                    // Limpiar archivo temporal
                    this.cleanupTempFile(tempFilePath);
                    
                    console.log('=== CAPTURA EXITOSA ===');
                    resolve(base64Image);
                    
                } catch (sharpError) {
                    console.error('❌ Error procesando imagen:', sharpError);
                    this.cleanupTempFile(tempFilePath);
                    reject(new Error(`Error de procesamiento: ${sharpError.message}`));
                }
            });
        });
    }
    
    async captureImageForPreview() {
        return new Promise((resolve, reject) => {
            const tempFileName = `preview_${Date.now()}.jpg`;
            const tempFilePath = path.join(this.tempDir, tempFileName);
            
            this.camera.capture(tempFilePath, async (err, data) => {
                if (err) {
                    reject(new Error(`Error de cámara: ${err.message}`));
                    return;
                }
                
                try {
                    if (!fs.existsSync(tempFilePath)) {
                        throw new Error('Archivo de preview no existe');
                    }
                    
                    const stats = fs.statSync(tempFilePath);
                    if (stats.size === 0) {
                        throw new Error('Archivo de preview vacío');
                    }
                    
                    const buffer = fs.readFileSync(tempFilePath);
                    let sharpInstance;
                    
                    // MANEJAR DIFERENTES FORMATOS para preview
                    if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
                        // JPEG
                        sharpInstance = sharp(tempFilePath);
                    } else if (buffer[0] === 0x42 && buffer[1] === 0x4D) {
                        // BMP → usar sharp-bmp
                        sharpInstance = sharpBmp.sharpFromBmp(tempFilePath);
                    } else {
                        // Otros formatos
                        sharpInstance = sharp(tempFilePath);
                    }
                    
                    // Redimensionar para preview
                    const previewBuffer = await sharpInstance
                        .resize(640, 480, {
                            fit: 'cover',
                            position: 'center'
                        })
                        .jpeg({ quality: 70 })
                        .toBuffer();
                    
                    const base64Preview = previewBuffer.toString('base64');
                    this.cleanupTempFile(tempFilePath);
                    resolve(base64Preview);
                    
                } catch (sharpError) {
                    this.cleanupTempFile(tempFilePath);
                    reject(new Error(`Error de procesamiento: ${sharpError.message}`));
                }
            });
        });
    }
    
    cleanupTempFile(filePath) {
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                console.log(`🗑️ Archivo temporal eliminado: ${path.basename(filePath)}`);
            }
        } catch (error) {
            console.warn('⚠️ No se pudo eliminar archivo temporal:', filePath);
        }
    }
    
    cleanup() {
        try {
            const files = fs.readdirSync(this.tempDir);
            for (const file of files) {
                this.cleanupTempFile(path.join(this.tempDir, file));
            }
            console.log('🧹 Cleanup completo');
        } catch (error) {
            console.warn('Error limpiando archivos temporales:', error);
        }
    }
    
    static listCameras() {
        console.log('📹 Para listar cámaras USB disponibles:');
        if (process.platform === 'win32') {
            console.log('Windows: wmic path Win32_USBControllerDevice get Dependent');
        } else {
            console.log('Linux/Mac: ls /dev/video*');
        }
    }
}

module.exports = CameraCapture;
