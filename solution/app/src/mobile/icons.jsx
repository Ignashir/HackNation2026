// Line icons (24x24, currentColor) in the spirit of iOS system symbols.
const S = ({ children, size = 24, fill = 'none', ...rest }) => (
  <svg
    width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor" strokeWidth="1.7"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}
  >
    {children}
  </svg>
);

export const IcDocs = (p) => <S {...p}><rect x="4" y="8" width="16" height="11" rx="2.5" /><path d="M6 5.5h12M8 3h8" /></S>;
export const IcDocsFill = (p) => (
  <S {...p}><rect x="4" y="8" width="16" height="11" rx="2.5" fill="currentColor" /><path d="M6 5.5h12M8 3h8" /></S>
);
export const IcFolder = (p) => <S {...p}><path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" /></S>;
export const IcFolderFill = (p) => <S {...p}><path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" fill="currentColor" /></S>;
export const IcQr = (p) => (
  <S {...p}>
    <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />
    <path d="M9 9v6M12 8v8M15 9v6" />
  </S>
);
export const IcMore = (p) => (
  <S {...p}><rect x="4" y="4" width="6.5" height="6.5" rx="2" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="2" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="2" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="2" /></S>
);
export const IcBell = (p) => <S {...p}><path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 1.5h-15zM10 20.5a2 2 0 0 0 4 0" /></S>;
export const IcSearch = (p) => <S {...p}><circle cx="11" cy="11" r="6" /><path d="m15.5 15.5 4 4" /></S>;
export const IcChevron = (p) => <S {...p}><path d="m9.5 6 6 6-6 6" /></S>;
export const IcBack = (p) => <S {...p}><path d="m14.5 5-7 7 7 7" /></S>;
export const IcClose = (p) => <S {...p}><path d="M6 6l12 12M18 6 6 18" /></S>;
export const IcHeart = (p) => <S {...p} fill="currentColor" stroke="none"><path d="M12 20.5S3.5 15.3 3.5 9.3A4.6 4.6 0 0 1 12 6.8a4.6 4.6 0 0 1 8.5 2.5c0 6-8.5 11.2-8.5 11.2z" /></S>;
export const IcShieldUser = (p) => <S {...p}><path d="M12 3.5 5 6v5.5c0 4.3 3 7.6 7 9 4-1.4 7-4.7 7-9V6z" /><circle cx="12" cy="10.5" r="2.2" /><path d="M8.5 16c.8-1.6 2-2.4 3.5-2.4s2.7.8 3.5 2.4" /></S>;
export const IcDoc = (p) => <S {...p}><path d="M7 3.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9.5A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5z" /><path d="M9 12h6M9 15.5h6" /></S>;
export const IcGlobeShield = (p) => <S {...p}><path d="M12 3.5 4.5 7v5c0 4 3.2 7.4 7.5 8.5 4.3-1.1 7.5-4.5 7.5-8.5V7z" /><path d="M9 11.5l2 2 4-4" /></S>;
export const IcIdSearch = (p) => <S {...p}><path d="M12 3.5 4.5 7v5c0 4 3.2 7.4 7.5 8.5 4.3-1.1 7.5-4.5 7.5-8.5V7z" /><circle cx="11.5" cy="11.5" r="2.5" /><path d="m13.5 13.5 2 2" /></S>;
export const IcBriefcase = (p) => <S {...p}><rect x="3.5" y="7.5" width="17" height="11.5" rx="2" /><path d="M9 7.5V5.5h6v2M3.5 12.5h17" /></S>;
export const IcCar = (p) => <S {...p}><path d="M5 16.5V12l2-5h10l2 5v4.5M4 16.5h16M7 19v-2.5M17 19v-2.5" /><circle cx="8" cy="13.5" r=".8" /><circle cx="16" cy="13.5" r=".8" /></S>;
export const IcCamera = (p) => <S {...p}><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.3l1.5-2h5.4l1.5 2h2.3A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" /><circle cx="12" cy="12.8" r="3.3" /></S>;
export const IcClock = (p) => <S {...p}><circle cx="12" cy="12" r="8" /><path d="M12 7.5V12l3 2" /></S>;
export const IcGear = (p) => <S {...p}><circle cx="12" cy="12" r="3" /><path d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M18 6l-1.6 1.6M7.6 16.4 6 18M18 18l-1.6-1.6M7.6 7.6 6 6" /></S>;
export const IcHelp = (p) => <S {...p}><circle cx="12" cy="12" r="8" /><path d="M9.8 9.6a2.3 2.3 0 0 1 4.4.8c0 1.6-2.2 2-2.2 3.4M12 16.6v.1" /></S>;
export const IcInfo = (p) => <S {...p}><circle cx="12" cy="12" r="8" /><path d="M12 11v5M12 8v.1" /></S>;
export const IcPlay = (p) => <S {...p}><rect x="3.5" y="5" width="17" height="11.5" rx="2" /><path d="M8.5 20h7M12 16.5V20M10.5 8.5l4 2.3-4 2.2z" /></S>;
export const IcList = (p) => <S {...p}><path d="M9 7h11M9 12h11M9 17h11M4.5 7h.1M4.5 12h.1M4.5 17h.1" /></S>;
export const IcBuilding = (p) => <S {...p} size={p.size ?? 16}><path d="M5 20V5.5A1.5 1.5 0 0 1 6.5 4h7A1.5 1.5 0 0 1 15 5.5V20M15 10h3.5a1.5 1.5 0 0 1 1.5 1.5V20M3.5 20h17M8.5 8h3M8.5 12h3M8.5 16h3" /></S>;
export const IcTree = (p) => <S {...p} size={p.size ?? 16}><path d="M12 20v-5M7 15h10l-5-11z" /></S>;
export const IcStairs = (p) => <S {...p} size={p.size ?? 16}><path d="M4 19h4v-4h4v-4h4V7h4" /></S>;
export const IcDoor = (p) => <S {...p} size={p.size ?? 16}><path d="M6 20V5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v15M4 20h16M14.5 12.5h.1" /></S>;
export const IcLock = (p) => <S {...p} size={p.size ?? 16}><rect x="5.5" y="10.5" width="13" height="9.5" rx="2" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" /></S>;
export const IcUnlock = (p) => <S {...p} size={p.size ?? 16}><rect x="5.5" y="10.5" width="13" height="9.5" rx="2" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 6.8-1.2" /></S>;
export const IcChild = (p) => <S {...p} size={p.size ?? 16}><circle cx="12" cy="6" r="2.2" /><path d="M8 11.5 12 10l4 1.5M12 10v5M9.5 20l2.5-5 2.5 5" /></S>;
export const IcTag = (p) => <S {...p} size={p.size ?? 16}><path d="M4 12.2V5.5A1.5 1.5 0 0 1 5.5 4h6.7l7.8 7.8-8.2 8.2z" /><circle cx="8.5" cy="8.5" r="1.2" /></S>;
export const IcPhone = (p) => <S {...p}><path d="M6.5 4h3l1.5 4-2 1.3a10 10 0 0 0 5.7 5.7L16 13l4 1.5v3a2 2 0 0 1-2.2 2A15.5 15.5 0 0 1 4.5 6.2 2 2 0 0 1 6.5 4z" /></S>;
export const IcMap = (p) => <S {...p}><path d="M9 5 4 7v12l5-2 6 2 5-2V5l-5 2zM9 5v12M15 7v12" /></S>;
export const IcCheck = (p) => <S {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></S>;
export const IcPin = (p) => <S {...p}><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.3" /></S>;
export const IcImage = (p) => <S {...p}><rect x="4" y="5" width="16" height="14" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="m4.5 17 5-4.5 3.5 3 2.5-2 4 3.5" /></S>;

// AED sign: heart with lightning bolt (ILCOR AED symbol idea).
export function IcAed({ size = 20, bolt = '#00843d' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 21S2.8 15.4 2.8 8.9A5 5 0 0 1 12 6.2a5 5 0 0 1 9.2 2.7C21.2 15.4 12 21 12 21z" fill="#fff" />
      <path d="M13.2 7.2 9 13.4h3l-1.1 4.6 4.3-6.4h-3z" fill={bolt} />
    </svg>
  );
}

// Generic state-app emblem placeholder (deliberately NOT the national emblem).
export function Emblem() {
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" aria-label="Aplikacja obywatela">
      <rect width="30" height="30" rx="7" fill="#dc143c" />
      <path d="M15 6.5 8.5 9v5.2c0 4.1 2.8 7.4 6.5 8.8 3.7-1.4 6.5-4.7 6.5-8.8V9z" fill="#fff" />
    </svg>
  );
}
