// JPEG markers / TIFF IFDs are read with bounded offsets. Export never re-encodes the image.
export const METADATA_LIMITS = Object.freeze({ fileBytes: 20 * 1024 ** 2, batchBytes: 100 * 1024 ** 2, files: 20, edge: 10000, pixels: 32_000_000 });
const encoder = new TextEncoder();
const starts = (data, text) => { const bytes = encoder.encode(text); return bytes.every((byte, i) => data[i] === byte); };
const ascii = data => new TextDecoder('utf-8', { fatal: false }).decode(data).replace(/\0.*$/s, '').replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, ' ').trim();
const frameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
const fields = new Map([[0x010e,'图片描述'],[0x010f,'设备厂商'],[0x0110,'设备型号'],[0x0131,'处理软件'],[0x0132,'修改时间'],[0x013b,'作者'],[0x8298,'版权'],[0x9003,'拍摄时间'],[0x9004,'数字化时间'],[0x9011,'拍摄时区'],[0xa430,'设备所有者'],[0xa431,'机身序列号'],[0xa433,'镜头厂商'],[0xa434,'镜头型号'],[0xa435,'镜头序列号'],[0x829a,'曝光时间'],[0x829d,'光圈'],[0x8827,'ISO'],[0x920a,'焦距']]);
export const ORIENTATIONS = ['未记录（按正常方向显示）','正常','水平镜像','旋转 180°','垂直镜像','转置','顺时针 90°','横向转置','逆时针 90°'];

export function readExifTIFF(t) {
  const view = new DataView(t.buffer, t.byteOffset, t.byteLength), result = { rows: [], orientation: undefined, colorSpace: undefined, adobeRGB: false, gps: false };
  const range = (offset, size) => { if (!Number.isSafeInteger(offset) || offset < 0 || size < 0 || offset + size > t.length) throw new Error('EXIF 字段越界'); };
  range(0, 8); const little = t[0] === 0x49 && t[1] === 0x49;
  if (!little && !(t[0] === 0x4d && t[1] === 0x4d)) throw new Error('EXIF 字节序无效');
  const u16 = o => { range(o,2); return view.getUint16(o,little); }, u32 = o => { range(o,4); return view.getUint32(o,little); };
  if (u16(2) !== 42) throw new Error('不支持的 EXIF TIFF 头');
  const visited = new Set(), sizes = {1:1,2:1,3:2,4:4,5:8,7:1,9:4,10:8,11:4,12:8,13:4}; let entries = 0;
  function directory(offset, group, depth = 0) {
    if (!offset) return; if (depth > 8 || visited.size >= 16 || visited.has(offset)) throw new Error('EXIF 目录循环或过多');
    visited.add(offset); const count = u16(offset); entries += count;
    if (entries > 2048) throw new Error('EXIF 字段过多'); range(offset + 2, count * 12 + 4);
    const values = new Map();
    for (let i = 0; i < count; i++) {
      const at = offset + 2 + i * 12, tag = u16(at), type = u16(at + 2), n = u32(at + 4), size = sizes[type];
      if (!size) throw new Error('EXIF 字段类型不支持');
      const length = n * size, start = length <= 4 ? at + 8 : u32(at + 8); range(start, length);
      const value = () => {
        if (type === 2) return ascii(t.subarray(start,start + Math.min(length,1024)));
        if (n > 4) return null;
        const list = Array.from({length:n}, (_, k) => { const p = start + k * size; if (type === 3) return u16(p); if (type === 4 || type === 13) return u32(p); if (type === 5 || type === 10) { const numerator = type === 5 ? u32(p) : view.getInt32(p,little), denominator = type === 5 ? u32(p+4) : view.getInt32(p+4,little); return denominator ? numerator / denominator : null; } if (type === 1 || type === 7) return t[p]; return null; });
        return n === 1 ? list[0] : list;
      };
      if (values.has(tag)) throw new Error('EXIF 包含重复字段'); values.set(tag, { value, type, count:n });
      if (group !== 'thumbnail' && fields.has(tag)) { const v = value(); if (v !== null && v !== '') result.rows.push({ name: fields.get(tag), value: Array.isArray(v) ? v.join(', ') : String(v) }); }
    }
    const get = tag => values.get(tag)?.value();
    if (group === 'main' && values.has(0x0112)) {
      const field = values.get(0x0112), value = get(0x0112);
      if (field.type !== 3 || field.count !== 1 || !Number.isInteger(value) || value < 1 || value > 8) throw new Error('EXIF 方向字段无效'); result.orientation = value;
    }
    if (group === 'exif') { const space = get(0xa001); if (space !== undefined) { const field = values.get(0xa001); if (field.type !== 3 || field.count !== 1 || space !== 1 && space !== 65535) throw new Error('EXIF 色彩空间无法可靠保留'); result.colorSpace = space; } if (values.has(0xa500)) throw new Error('首版不处理附加 Gamma 色彩参数'); }
    if (group === 'interop' && get(1) === 'R03') result.adobeRGB = true;
    if (group === 'gps') {
      result.gps = true;
      const coordinate = (tag, refTag, positive, negative, max) => { const d = get(tag), ref = get(refTag); if (!Array.isArray(d) || d.length !== 3 || !d.every(Number.isFinite) || d[0] < 0 || d[1] < 0 || d[1] >= 60 || d[2] < 0 || d[2] >= 60 || ![positive,negative].includes(ref)) return null; const v = d[0] + d[1]/60 + d[2]/3600; return v <= max ? (ref === negative ? -v : v).toFixed(6) : null; };
      const lat = coordinate(2,1,'N','S',90), lon = coordinate(4,3,'E','W',180);
      result.rows.push({name:'GPS 位置',value:lat !== null && lon !== null ? `${lat}, ${lon}` : '包含 GPS 字段（坐标未完整解析）'});
    }
    const children = group === 'main' ? [[0x8769,'exif'],[0x8825,'gps']] : group === 'exif' ? [[0xa005,'interop']] : [];
    for (const [tag, name] of children) if (values.has(tag)) { const field = values.get(tag); if (![4,13].includes(field.type) || field.count !== 1) throw new Error('EXIF 子目录指针无效'); directory(get(tag),name,depth+1); }
    const next = u32(offset + 2 + count * 12); if (next) directory(next,'thumbnail',depth+1);
  }
  directory(u32(4),'main'); return result;
}

export function jpegSegment(marker, payload) {
  if (payload.length > 65533) throw new Error('JPEG 数据段过长');
  const out = new Uint8Array(payload.length + 4); out.set([255,marker,(payload.length+2) >> 8,(payload.length+2) & 255]); out.set(payload,4); return out;
}
export function minimalExifTIFF(orientation, colorSpace) {
  const tags = []; if (orientation !== undefined) tags.push([0x0112,orientation]);
  // ColorSpace belongs to the Exif sub-IFD, not IFD0.
  const mainCount = tags.length + (colorSpace !== undefined ? 1 : 0), sub = 8 + 2 + mainCount*12 + 4;
  const t = new Uint8Array(sub + (colorSpace !== undefined ? 18 : 0)), v = new DataView(t.buffer); t.set([0x49,0x49,42,0,8,0,0,0]); v.setUint16(8,mainCount,true);
  tags.forEach(([tag,value],i) => { const p = 10+i*12; v.setUint16(p,tag,true); v.setUint16(p+2,3,true); v.setUint32(p+4,1,true); v.setUint16(p+8,value,true); });
  if (colorSpace !== undefined) { const p = 10+tags.length*12; v.setUint16(p,0x8769,true); v.setUint16(p+2,4,true); v.setUint32(p+4,1,true); v.setUint32(p+8,sub,true); v.setUint16(sub,1,true); v.setUint16(sub+2,0xa001,true); v.setUint16(sub+4,3,true); v.setUint32(sub+6,1,true); v.setUint16(sub+10,colorSpace,true); }
  return t;
}
function minimalExif(orientation, colorSpace) { const t = minimalExifTIFF(orientation,colorSpace), payload = new Uint8Array(6+t.length); payload.set([69,120,105,102,0,0]); payload.set(t,6); return jpegSegment(0xe1,payload); }

export function inspectJPEG(bytes) {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > METADATA_LIMITS.fileBytes) throw new Error('请选择非空 JPG/JPEG，单张最高 20 MB。');
  if (bytes[0] !== 255 || bytes[1] !== 0xd8) throw new Error('文件内容不是 JPEG；首版仅支持 JPG/JPEG。');
  const parts = [], blocks = [], rows = [], orientations = new Set(), xmpOrientations = new Set(), spaces = new Set(), warnings = [], icc = [];
  let at = 2, end = 0, width, height, components, scans = 0, exifCount = 0, orientation, colorSpace, gps = false, adobeRGB = false, blocked = '';
  while (at < bytes.length) {
    if (parts.length > 4096) throw new Error('JPEG 数据段过多，暂不支持。');
    const start = at; if (bytes[at++] !== 255) throw new Error('JPEG 数据段损坏。'); while (bytes[at] === 255) at++;
    const marker = bytes[at++]; if (marker === 0xd9) { end = at; parts.push({start,end:at,marker}); break; }
    if (marker === 0xd8 || marker === 0 || marker === undefined || marker >= 0xd0 && marker <= 0xd7) throw new Error('JPEG 标记无效。');
    if (marker === 1) { parts.push({start,end:at,marker}); continue; }
    if (at + 2 > bytes.length) throw new Error('JPEG 数据段被截断。');
    const length = bytes[at]*256+bytes[at+1], next = at + length;
    if (length < 2 || next > bytes.length) throw new Error('JPEG 数据段长度无效。');
    const data = bytes.subarray(at+2,next), part = {start,end:next,marker}; parts.push(part); at = next;
    if (frameMarkers.has(marker)) {
      if (width || ![0xc0,0xc1,0xc2].includes(marker) || data[0] !== 8 || data.length < 6) throw new Error('首版支持 8 位普通或渐进式 JPEG。');
      height = data[1]*256+data[2]; width = data[3]*256+data[4]; components = data[5];
      if (![1,3,4].includes(components) || data.length !== 6+components*3 || !width || !height || width > METADATA_LIMITS.edge || height > METADATA_LIMITS.edge || width*height > METADATA_LIMITS.pixels) throw new Error('JPEG 尺寸不支持：单边最高 10000 px、总像素最高 3200 万。');
    }
    if (marker >= 0xe0 && marker <= 0xef || marker === 0xfe) {
      let name = `其他 APP${marker-0xe0}`, keep = false;
      if (marker === 0xe1 && starts(data,'Exif\0\0')) {
        name = 'EXIF 拍摄信息';
        exifCount++; if (exifCount > 1 || scans) blocked = '检测到多个 EXIF 段或扫描后的 EXIF，浏览器对方向与色彩的解释可能不同。请先另存为普通 JPEG。';
        try { const exif = readExifTIFF(data.subarray(6)); rows.push(...exif.rows); if (exif.orientation !== undefined) orientations.add(exif.orientation); if (exif.colorSpace !== undefined) spaces.add(exif.colorSpace); gps ||= exif.gps; adobeRGB ||= exif.adobeRGB; }
        catch { blocked = 'EXIF 结构异常，无法可靠保留方向与色彩。请先另存为普通 JPEG。'; warnings.push('部分 EXIF 未解析；不会生成清理文件。'); }
      } else if (marker === 0xe0 && starts(data,'JFIF\0')) {
        if (data.length < 14) throw new Error('JFIF 头不完整。');
        name = data.length > 14 || data[12] || data[13] ? 'JFIF（含缩略图或附加数据）' : 'JFIF 基本信息';
        const basic = data.slice(0,14); basic[12] = basic[13] = 0; part.replacement = jpegSegment(marker,basic); keep = true;
      } else if (marker === 0xe2 && starts(data,'ICC_PROFILE\0')) { name = 'ICC 色彩配置'; keep = true; icc.push(data); if (scans) blocked = 'ICC 色彩配置位于图像扫描之后，无法可靠保留颜色，请先另存为普通 JPEG。'; }
      else if (marker === 0xee && starts(data,'Adobe')) { if (data.length < 12) throw new Error('Adobe 色彩标记损坏。'); name = 'Adobe 色彩标记'; keep = true; part.replacement = jpegSegment(marker,data.slice(0,12)); }
      else if (marker === 0xe1 && (starts(data,'http://ns.adobe.com/xap/') || starts(data,'http://ns.adobe.com/xmp/'))) {
        name = 'XMP 附加信息'; const xml = new TextDecoder().decode(data);
        for (const match of xml.matchAll(/\b[\w-]+:Orientation\s*(?:=\s*["']([^"']*)["']|>\s*([^<]*)<)/g)) { const value = Number((match[1] ?? match[2]).trim()); if (!Number.isInteger(value) || value < 1 || value > 8) blocked = 'XMP 方向字段无法可靠解析，请先另存为普通 JPEG。'; else xmpOrientations.add(value); }
      }
      else if (marker === 0xed) name = 'IPTC / Photoshop 信息';
      else if (marker === 0xeb) name = 'APP11 / 内容凭证等信息';
      else if (marker === 0xfe) name = 'JPEG 注释';
      if (starts(data,'MPF\0') || starts(data,'SPIFF\0') || /hdrgm:|hdr-gain-map|HDRGainMap|urn:iso:std:iso:ts:21496/i.test(new TextDecoder('latin1').decode(data))) blocked = '检测到多画面、HDR 或 SPIFF 扩展；首版仅清理普通单画面 JPEG，请先另存副本。';
      part.keep = keep; blocks.push({name,bytes:next-start,kept:keep});
    }
    if (marker === 0xda) {
      if (!width || data.length < 4 || data[0] < 1 || data[0] > components || data.length !== 1+2*data[0]+3) throw new Error('JPEG 扫描头无效。');
      scans++; const scanStart = at; let found = false;
      while (at < bytes.length) { if (bytes[at++] !== 255) continue; const begin = at-1; while (bytes[at] === 255) at++; if (bytes[at] === 0 || bytes[at] >= 0xd0 && bytes[at] <= 0xd7) { at++; continue; } at = begin; found = true; break; }
      if (!found) throw new Error('JPEG 缺少结束标记。'); parts.push({start:scanStart,end:at,marker:'scan'});
    }
  }
  if (!end || !width || !scans) throw new Error('JPEG 文件不完整或没有画面数据。');
  if (orientations.size > 1 || spaces.size > 1) blocked = '多个 EXIF 段的方向或色彩配置冲突，请先另存为普通 JPEG。';
  orientation = [...orientations][0]; colorSpace = [...spaces][0];
  if ([...xmpOrientations].some(value => value !== orientation)) blocked = 'XMP 与 EXIF 方向不一致或仅有 XMP 方向，请先另存为普通 JPEG。';
  if (icc.length && (icc.some(d => d.length < 15 || d[13] !== icc.length || !d[12] || d[12] > icc.length) || new Set(icc.map(d=>d[12])).size !== icc.length)) blocked = 'ICC 色彩配置分段不完整或重复，无法可靠保留颜色。';
  if (!icc.length && (adobeRGB || colorSpace === 65535)) blocked = '该 JPEG 标记为非 sRGB 且没有 ICC 配置，首版无法保证清理后的颜色，请先另存为 sRGB JPEG。';
  if (end < bytes.length) blocks.push({name:'结束标记后的附加数据',bytes:bytes.length-end,kept:false});
  if (blocks.some(b=>b.name.startsWith('XMP') || b.name.startsWith('IPTC') || b.name.startsWith('其他'))) warnings.push('只展开常用 EXIF 字段；未展开的 XMP、IPTC 和其他附加信息也会清理。');
  return {width,height,components,scans,orientation,colorSpace,gps,icc:icc.length>0,rows,blocks,warnings,blocked,parts,end};
}

export function cleanJPEG(bytes) {
  const before = inspectJPEG(bytes); if (before.blocked) throw new Error(before.blocked);
  const chunks = [bytes.subarray(0,2)]; let inserted = false;
  const insertExif = () => { if (!inserted && (before.orientation !== undefined || before.colorSpace !== undefined)) chunks.push(minimalExif(before.orientation,before.colorSpace)); inserted = true; };
  for (const part of before.parts) {
    // Place the new minimal EXIF after APP0 and before image data / other metadata.
    if (part.marker !== 0xe0) insertExif();
    if (typeof part.marker === 'number' && (part.marker >= 0xe0 && part.marker <= 0xef || part.marker === 0xfe)) { if (part.keep) chunks.push(part.replacement || bytes.subarray(part.start,part.end)); }
    else chunks.push(bytes.subarray(part.start,part.end));
  }
  const output = new Uint8Array(chunks.reduce((n,c)=>n+c.length,0)); let at=0; for (const chunk of chunks) { output.set(chunk,at); at+=chunk.length; }
  const after = inspectJPEG(output);
  if (after.blocked || after.rows.length || after.gps || after.orientation !== before.orientation || after.colorSpace !== before.colorSpace || after.width !== before.width || after.height !== before.height) throw new Error('清理结果校验失败，请保留原文件。');
  return {output,before,after};
}
export function metadataFilename(name = 'image.jpg', mime = 'image/jpeg') { return `${name.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069/\\:*?"<>|]/g,'-').replace(/\.[^.]*$/,'').replace(/^[.\s]+/,'').slice(0,120) || 'image'}-clean.${mime === 'image/png' ? 'png' : 'jpg'}`; }
