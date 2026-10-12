/** Link only recognized license names; custom permission uses the selected file's source page. */
export function imageLicenseUrl(
  license: string,
  source: string,
): string | null {
  const cc = /^CC (BY(?:-SA|-ND|-NC(?:-SA|-ND)?)?) (\d\.\d)$/i.exec(
    license.trim(),
  );
  if (cc)
    return `https://creativecommons.org/licenses/${cc[1].toLowerCase()}/${cc[2]}/`;
  if (/^CC0 1\.0$/i.test(license.trim()))
    return "https://creativecommons.org/publicdomain/zero/1.0/";
  if (
    /^(?:Public domain|Attribution permission)(?:$|\s|\()/i.test(license) &&
    source
  ) {
    try {
      const url = new URL(source);
      if (!["https:", "http:"].includes(url.protocol)) return null;
      url.hash = "Licensing";
      return url.href;
    } catch {
      return null;
    }
  }
  return null;
}
