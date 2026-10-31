import type { SVGProps } from 'react';

/** Набор линейных иконок: единая толщина штриха и сетка 24×24. */
function base(path: React.ReactNode) {
  return function Icon(props: SVGProps<SVGSVGElement>) {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
        {path}
      </svg>
    );
  };
}

export const IconSearch = base(<><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>);
export const IconClose = base(<path d="M6 6l12 12M18 6 6 18" />);
export const IconChevronLeft = base(<path d="m15 5-7 7 7 7" />);
export const IconChevronRight = base(<path d="m9 5 7 7-7 7" />);
export const IconBook = base(<path d="M12 6.5C10 5 6.5 4.7 3.5 5.5v13c3-.8 6.5-.5 8.5 1 2-1.500 5.500-1.800 8.500-1v-13c-3-.8-6.500-.5-8.500 1zm0 0v13" />);
export const IconList = base(<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />);
export const IconBookmark = base(<path d="M7 4h10v16l-5-3.500L7 20z" />);
export const IconPalette = base(<><path d="M12 3.500a8.500 8.500 0 1 0 0 17c1.500 0 2-1 2-1.900 0-1.300-1-1.500-1-2.700 0-.9.700-1.500 1.700-1.500h2.300a3.500 3.500 0 0 0 3.500-3.500c0-4.200-3.800-7.400-8.500-7.400z" /><circle cx="7.800" cy="12" r="1" /><circle cx="10" cy="8" r="1" /><circle cx="14.500" cy="8" r="1" /></>);
export const IconHeadphones = base(<><path d="M4 15v-3a8 8 0 0 1 16 0v3" /><rect x="3.500" y="14" width="4" height="6" rx="1.500" /><rect x="16.500" y="14" width="4" height="6" rx="1.500" /></>);
export const IconExpand = base(<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />);
export const IconPlay = base(<path d="M7 4.500v15l12-7.500z" />);
export const IconPause = base(<path d="M8 5v14M16 5v14" />);
export const IconSound = base(<><path d="M4 9.500v5h3.500L12 18.500v-13L7.500 9.500z" /><path d="M15.500 9a4 4 0 0 1 0 6" /></>);
export const IconMute = base(<><path d="M4 9.500v5h3.500L12 18.500v-13L7.500 9.500z" /><path d="m16 9.500 4 5M20 9.500l-4 5" /></>);
export const IconCopy = base(<><rect x="8.500" y="8.500" width="11" height="11" rx="2" /><path d="M15.500 8.500v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" /></>);
export const IconCheck = base(<path d="m5 12.500 4.500 4.500L19 7.500" />);
export const IconInfo = base(<><circle cx="12" cy="12" r="8.500" /><path d="M12 11v5M12 8h.01" /></>);
export const IconStar = base(<path d="m12 4 2.500 5.200 5.700.8-4.100 4 1 5.700-5.100-2.700L6.900 19.700l1-5.700-4.100-4 5.700-.8z" />);
export const IconGear = base(<><circle cx="12" cy="12" r="3" /><path d="M12 3v2.500M12 18.500V21M3 12h2.500M18.500 12H21M5.600 5.600l1.800 1.800M16.600 16.600l1.800 1.800M5.600 18.400l1.800-1.800M16.600 7.400l1.800-1.800" /></>);
export const IconFeather = base(<path d="M19.500 4.500c-5-.8-11 1.500-12.500 7-.6 2.200-.5 4.500-.5 6.500m0 0 11-11M6.500 18l-2 2m3-5.500 5.500.2M10 10.500l6.500.2" />);
export const IconTrash = base(<path d="M5 7h14M10 7V4.500h4V7M7 7l1 12.500h8L17 7" />);
export const IconHome = base(<path d="M4 11.500 12 5l8 6.500M6.500 10v9.500h11V10" />);
export const IconEye = base(<><path d="M3 12s3.500-6.500 9-6.500S21 12 21 12s-3.500 6.500-9 6.500S3 12 3 12z" /><circle cx="12" cy="12" r="2.500" /></>);
export const IconEyeOff = base(<path d="M4 4l16 16M10 5.800c.6-.2 1.300-.3 2-.3 5.500 0 9 6.500 9 6.500a16 16 0 0 1-3.200 3.900M6.500 7.200A15.500 15.500 0 0 0 3 12s3.500 6.500 9 6.500c1.500 0 2.800-.4 4-1" />);
export const IconQuote = base(<path d="M9.500 8H6a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h1.500l-1 3M19.500 8H16a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h1.500l-1 3" />);
export const IconHighlight = base(<path d="m14 5 5 5-8.500 8.500-5.500.5.500-5.500zM4 21h16" />);
export const IconTelegram = base(<path d="M21 4.500 3 11.500l6 2.200M21 4.500l-3 15-8.500-5.800M21 4.500 9 13.700m.5 0-.5 5.300 3-3.200" />);
