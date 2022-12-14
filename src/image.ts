// Define some constants
export const GAMEBOY_CAMERA_WIDTH = 160;
export const GAMEBOY_CAMERA_HEIGHT = 144;

// Function to get our RGB image data array from our frame
export const getImageDataFromFrame = async (wasmboy: any, wasmByteMemoryArray: Uint8Array) => {

    const frameInProgressMemory = wasmByteMemoryArray.slice(
        wasmboy.FRAME_LOCATION,
        wasmboy.FRAME_LOCATION + GAMEBOY_CAMERA_HEIGHT * GAMEBOY_CAMERA_WIDTH * 3 + 1)

    // Going to compare pixel values from the VRAM to confirm tests
    const imageDataArray = [];
    const rgbColor = [];

    for (let y = 0; y < GAMEBOY_CAMERA_HEIGHT; y++) {
        for (let x = 0; x < GAMEBOY_CAMERA_WIDTH; x++) {
            // Each color has an R G B component
            let pixelStart = (y * GAMEBOY_CAMERA_WIDTH + x) * 3;

            for (let color = 0; color < 3; color++) {
                rgbColor[color] = frameInProgressMemory[pixelStart + color];
            }

            // Doing graphics using second answer on:
            // https://stackoverflow.com/questions/4899799/whats-the-best-way-to-set-a-single-pixel-in-an-html5-canvas
            // Image Data mapping
            const imageDataIndex = (x + y * GAMEBOY_CAMERA_WIDTH) * 4;

            imageDataArray[imageDataIndex] = rgbColor[0];
            imageDataArray[imageDataIndex + 1] = rgbColor[1];
            imageDataArray[imageDataIndex + 2] = rgbColor[2];
            // Alpha, no transparency
            imageDataArray[imageDataIndex + 3] = 255;
        }
    }

    return imageDataArray;
};

export const arraysEqual = (a: any[], b: any[]) => {
    if (a?.length != b?.length) {
        return false;
    }

    for (let i = 0; i < a.length; i++) {
        if (a[i] != b[i]) {
            return false;
        }
    }

    return true;
}