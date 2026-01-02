// Color space conversion functions
// Using BT.709 coefficients

// RGB to YCbCr
fn rgb_to_ycbcr(rgb: vec3f) -> vec3f {
    let y  =  0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b;
    let cb = -0.1146 * rgb.r - 0.3854 * rgb.g + 0.5000 * rgb.b;
    let cr =  0.5000 * rgb.r - 0.4542 * rgb.g - 0.0458 * rgb.b;
    return vec3f(y, cb, cr);
}

// YCbCr to RGB
fn ycbcr_to_rgb(ycbcr: vec3f) -> vec3f {
    let y  = ycbcr.x;
    let cb = ycbcr.y;
    let cr = ycbcr.z;
    let r = y + 1.5748 * cr;
    let g = y - 0.1873 * cb - 0.4681 * cr;
    let b = y + 1.8556 * cb;
    return vec3f(r, g, b);
}
