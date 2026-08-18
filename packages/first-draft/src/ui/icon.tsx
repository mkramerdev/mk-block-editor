import { createElement, type SVGProps } from "react";
import type { FirstDraftIconData } from "./icons.ts";

export interface FirstDraftIconProps
  extends Omit<SVGProps<SVGSVGElement>, "children"> {
  readonly icon: FirstDraftIconData;
  readonly size?: number | string;
}

export function FirstDraftIcon({
  icon,
  size = 14,
  fill = "none",
  stroke = "currentColor",
  strokeLinecap = "round",
  strokeLinejoin = "round",
  strokeWidth = 2,
  ...props
}: FirstDraftIconProps) {
  return (
    <svg
      {...props}
      width={size}
      height={size}
      viewBox={icon.viewBox}
      fill={fill}
      stroke={stroke}
      strokeLinecap={strokeLinecap}
      strokeLinejoin={strokeLinejoin}
      strokeWidth={strokeWidth}
      xmlns="http://www.w3.org/2000/svg"
    >
      {icon.elements.map((element, index) =>
        createElement(element.tag, { key: index, ...element.attrs }),
      )}
    </svg>
  );
}
