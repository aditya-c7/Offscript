import type { Metadata } from "next";

import { ScanList } from "@/components/scans/scan-list";

export const metadata: Metadata = {
  title: "Scans · Offscript",
};

export default function ScansPage(): React.JSX.Element {
  return <ScanList />;
}
