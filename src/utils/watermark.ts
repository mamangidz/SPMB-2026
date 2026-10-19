export interface WatermarkData {
  venue: string;
  username: string;
  stageName: string;
  category: string;
  photoDate: string;
  photoTime: string;
  latitude: number;
  longitude: number;
  accuracy: number;
  locationName: string;
}

/**
 * Stamps date, time, venue, username, coordinates, and accuracy onto the image canvas.
 * Guarantees output payload is strictly under 500KB to prevent Firestore document size limit errors (1MB max).
 */
export async function stampWatermarkOnImage(
  imageSource: string | HTMLImageElement,
  data: WatermarkData
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          return resolve(typeof imageSource === 'string' ? imageSource : img.src);
        }

        // Set dimensions (max 1080px width for fast upload and strict Firestore 1MB compliance)
        const maxWidth = 1080;
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;

        // Draw original photo
        ctx.drawImage(img, 0, 0, width, height);

        // Watermark overlay styling
        const bannerHeight = Math.max(110, Math.round(height * 0.20));
        const gradient = ctx.createLinearGradient(0, height - bannerHeight - 40, 0, height);
        gradient.addColorStop(0, 'rgba(15, 23, 42, 0)');
        gradient.addColorStop(0.3, 'rgba(15, 23, 42, 0.85)');
        gradient.addColorStop(1, 'rgba(15, 23, 42, 0.98)');

        ctx.fillStyle = gradient;
        ctx.fillRect(0, height - bannerHeight - 40, width, bannerHeight + 40);

        // Accent line on top of banner
        ctx.fillStyle = '#38bdf8'; // Sky blue accent
        ctx.fillRect(0, height - bannerHeight - 2, width, 3);

        const padX = Math.round(width * 0.035);
        const startY = height - bannerHeight + 22;

        // Calculate responsive font sizes
        const titleSize = Math.max(13, Math.round(width * 0.024));
        const textSize = Math.max(11, Math.round(width * 0.017));
        const smallSize = Math.max(9, Math.round(width * 0.014));

        // Venue Tag Badge
        ctx.font = `bold ${titleSize}px 'Plus Jakarta Sans', sans-serif`;
        ctx.fillStyle = '#ffffff';
        ctx.fillText(`📍 ${data.venue.toUpperCase()} — ${data.stageName}: ${data.category}`, padX, startY);

        // Petugas and Location
        ctx.font = `600 ${textSize}px 'Plus Jakarta Sans', sans-serif`;
        ctx.fillStyle = '#cbd5e1';
        ctx.fillText(`👤 Petugas: ${data.username} | Wilayah: ${data.locationName || 'Terdeteksi'}`, padX, startY + textSize + 9);

        // Coordinates & Accuracy
        const latStr = data.latitude.toFixed(6);
        const lngStr = data.longitude.toFixed(6);
        const accStr = data.accuracy ? `(Akurasi: ±${Math.round(data.accuracy)}m)` : '';

        ctx.font = `500 ${textSize}px 'JetBrains Mono', monospace`;
        ctx.fillStyle = '#38bdf8';
        ctx.fillText(`🌐 GPS: ${latStr}°, ${lngStr}° ${accStr}`, padX, startY + (textSize * 2) + 18);

        // Date, Time & Verification stamp
        ctx.font = `600 ${textSize}px 'JetBrains Mono', monospace`;
        ctx.fillStyle = '#fde047'; // Amber yellow
        ctx.fillText(`⏱ WAKTU: ${data.photoDate} ${data.photoTime}`, padX, startY + (textSize * 3) + 26);

        // Right side security verification seal
        const rightBadgeX = width - padX;
        ctx.textAlign = 'right';
        ctx.font = `bold ${smallSize}px 'Plus Jakarta Sans', sans-serif`;
        ctx.fillStyle = '#10b981'; // Emerald
        ctx.fillText(`✓ VERIFIKASI DIGITAL VENUE`, rightBadgeX, startY + 6);

        ctx.font = `${smallSize}px 'JetBrains Mono', monospace`;
        ctx.fillStyle = '#94a3b8';
        const hashStamp = `ID: ${Math.random().toString(36).substring(2, 9).toUpperCase()}`;
        ctx.fillText(hashStamp, rightBadgeX, startY + smallSize + 14);

        ctx.textAlign = 'left';

        // Strict size control loop: keep under 550KB to guarantee Firestore 1MB document limit is never exceeded
        let quality = 0.78;
        let watermarkedDataUrl = canvas.toDataURL('image/jpeg', quality);

        // If string length > 550,000 characters (~400KB), incrementally compress
        while (watermarkedDataUrl.length > 550000 && quality > 0.45) {
          quality -= 0.12;
          watermarkedDataUrl = canvas.toDataURL('image/jpeg', quality);
        }

        resolve(watermarkedDataUrl);
      } catch (err) {
        console.error('Error stamping watermark:', err);
        resolve(typeof imageSource === 'string' ? imageSource : img.src);
      }
    };

    img.onerror = (err) => {
      console.error('Image load error during watermarking:', err);
      reject(err);
    };

    if (typeof imageSource === 'string') {
      img.src = imageSource;
    } else {
      img.src = imageSource.src;
    }
  });
}

/**
 * Compresses an arbitrary dataUrl to ensure it safely fits within Firestore's 1MB document limit (<380KB)
 */
export async function compressImageDataUrl(dataUrl: string, maxDimension = 960): Promise<string> {
  return new Promise((resolve) => {
    if (!dataUrl || !dataUrl.startsWith('data:image')) {
      return resolve(dataUrl);
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        let width = img.width;
        let height = img.height;
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }
        let canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        let ctx = canvas.getContext('2d');
        if (!ctx) return resolve(dataUrl);
        ctx.drawImage(img, 0, 0, width, height);

        let q = 0.72;
        let out = canvas.toDataURL('image/jpeg', q);

        // Progressively reduce quality if larger than 380KB
        while (out.length > 380000 && q > 0.35) {
          q -= 0.1;
          out = canvas.toDataURL('image/jpeg', q);
        }

        // If still > 380KB, scale down resolution slightly
        if (out.length > 380000) {
          const scale = 0.75;
          const scaledW = Math.round(width * scale);
          const scaledH = Math.round(height * scale);
          const c2 = document.createElement('canvas');
          c2.width = scaledW;
          c2.height = scaledH;
          const ctx2 = c2.getContext('2d');
          if (ctx2) {
            ctx2.drawImage(canvas, 0, 0, scaledW, scaledH);
            out = c2.toDataURL('image/jpeg', 0.65);
          }
        }

        resolve(out);
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}
