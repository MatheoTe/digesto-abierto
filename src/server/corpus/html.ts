/**
 * Plain text out of the HTML files the Concejo Deliberante publishes for each
 * ordinance (Word / LibreOffice exports). Whitespace inside the HTML source is
 * insignificant, so it is collapsed first and line breaks are re-inserted only
 * at block boundaries: a paragraph the export wrapped over five source lines
 * comes back as one line.
 */

const NAMED: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", yacute: "ý",
  Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", Yacute: "Ý",
  agrave: "à", egrave: "è", igrave: "ì", ograve: "ò", ugrave: "ù",
  Agrave: "À", Egrave: "È", Igrave: "Ì", Ograve: "Ò", Ugrave: "Ù",
  auml: "ä", euml: "ë", iuml: "ï", ouml: "ö", uuml: "ü", Auml: "Ä", Euml: "Ë", Iuml: "Ï", Ouml: "Ö", Uuml: "Ü",
  acirc: "â", ecirc: "ê", icirc: "î", ocirc: "ô", ucirc: "û",
  ntilde: "ñ", Ntilde: "Ñ", ccedil: "ç", Ccedil: "Ç",
  ordm: "º", ordf: "ª", deg: "°", iexcl: "¡", iquest: "¿", laquo: "«", raquo: "»",
  ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", sbquo: "‚", bdquo: "„",
  ndash: "–", mdash: "—", hellip: "…", bull: "•", middot: "·", sect: "§", para: "¶",
  copy: "©", reg: "®", euro: "€", pound: "£", cent: "¢", frac12: "½", frac14: "¼", frac34: "¾",
  sup1: "¹", sup2: "²", sup3: "³", times: "×", divide: "÷", plusmn: "±", shy: "",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (match, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match;
    }
    return NAMED[body] ?? match;
  });
}

/** The charset the file declares; the Concejo's exports are UTF-8 or windows-1252. */
export function decodeBytes(bytes: Uint8Array): string {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 4096));
  const declared = /charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1]?.toLowerCase();
  if (declared && declared !== "utf-8" && declared !== "utf8") {
    try {
      return new TextDecoder(declared === "iso-8859-1" ? "windows-1252" : declared).decode(bytes);
    } catch {
      return new TextDecoder("windows-1252").decode(bytes);
    }
  }
  const utf8 = new TextDecoder("utf-8").decode(bytes);
  // Undeclared and not valid UTF-8: the old Word exports are windows-1252.
  return !declared && utf8.includes("�") ? new TextDecoder("windows-1252").decode(bytes) : utf8;
}

const BLOCK_END = /<\/(p|div|h[1-6]|li|tr|table|blockquote|center|ul|ol|dd|dt|title)\s*>|<br\s*\/?>|<(p|div|h[1-6]|li|tr|table|blockquote|center|hr)(\s[^>]*)?>/gi;

export function htmlToText(html: string): string {
  let s = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|head|xml|object)[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<img[^>]*>/gi, " ")
    // Cloudflare's hidden e-mail-protection anchor, and its decoded placeholder text.
    .replace(/<a[^>]*cdn-cgi[^>]*>[\s\S]*?<\/a>/gi, " ");
  s = s.replace(/\s+/g, " ");
  s = s.replace(/<\/t[dh]\s*>/gi, " \t ");
  s = s.replace(BLOCK_END, "\n");
  s = s.replace(/<[^>]+>/g, "");
  s = decodeEntities(s);
  return s
    .split("\n")
    .map((line) => line.replace(/[ \t ​]+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}
