const startsWith = (data: Buffer, bytes: number[]) => data.subarray(0, bytes.length).equals(Buffer.from(bytes));

export function fileMatchesType(data: Buffer, type: string): boolean {
  switch (type) {
    case 'image/jpeg':
      return startsWith(data, [255, 216, 255]);
    case 'image/png':
      return startsWith(data, [137, 80, 78, 71, 13, 10, 26, 10]);
    case 'image/webp':
      return data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP';
    case 'application/pdf':
      return data.toString('ascii', 0, 5) === '%PDF-';
    default:
      return false;
  }
}
