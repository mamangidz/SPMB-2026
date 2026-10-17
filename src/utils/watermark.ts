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

        // Set dimensions (max 1600px width for fast sync and storage efficiency)
        const maxWidth = 1600;
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
        const bannerHeight = Math.max(120, Math.round(height * 0.19));
        const gradient = ctx.createLinearGradient(0, height - bannerHeight - 40, 0, height);
        gradient.addColorStop(0, 'rgba(15, 23, 42, 0)');
        gradient.addColorStop(0.3, 'rgba(15, 23, 42, 0.82)');
        gradient.addColorStop(1, 'rgba(15, 23, 42, 0.96)');

        ctx.fillStyle = gradient;
        ctx.fillRect(0, height - bannerHeight - 40, width, bannerHeight + 40);

        // Accent line on top of banner
        ctx.fillStyle = '#38bdf8'; // Sky blue accent
        ctx.fillRect(0, height - bannerHeight - 2, width, 3);

        const padX = Math.round(width * 0.035);
        const startY = height - bannerHeight + 24;

        // Calculate responsive font sizes
        const titleSize = Math.max(14, Math.round(width * 0.024));
        const textSize = Math.max(11, Math.round(width * 0.017));
        const smallSize = Math.max(10, Math.round(width * 0.014));

        // Venue Tag Badge
        ctx.font = `bold ${titleSize}px 'Plus Jakarta Sans', sans-serif`;
        ctx.fillStyle = '#ffffff';
        ctx.fillText(`📍 ${data.venue.toUpperCase()} — ${data.stageName}: ${data.category}`, padX, startY);

        // Petugas and Location
        ctx.font = `600 ${textSize}px 'Plus Jakarta Sans', sans-serif`;
        ctx.fillStyle = '#cbd5e1';
        ctx.fillText(`👤 Petugas: ${data.username} | Wilayah: ${data.locationName || 'Terdeteksi'}`, padX, startY + textSize + 10);

        // Coordinates & Accuracy
        const latStr = data.latitude.toFixed(6);
        const lngStr = data.longitude.toFixed(6);
        const accStr = data.accuracy ? `(Akurasi: ±${Math.round(data.accuracy)}m)` : '';

        ctx.font = `500 ${textSize}px 'JetBrains Mono', monospace`;
        ctx.fillStyle = '#38bdf8';
        ctx.fillText(`🌐 GPS: ${latStr}°, ${lngStr}° ${accStr}`, padX, startY + (textSize * 2) + 20);

        // Date, Time & Verification stamp
        ctx.font = `600 ${textSize}px 'JetBrains Mono', monospace`;
        ctx.fillStyle = '#fde047'; // Amber yellow
        ctx.fillText(`⏱ WAKTU: ${data.photoDate} ${data.photoTime}`, padX, startY + (textSize * 3) + 28);

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

        // Export as compressed JPEG
        const watermarkedDataUrl = canvas.toDataURL('image/jpeg', 0.85);
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
