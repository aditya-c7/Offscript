import { ScanReportView } from "@/components/scans/scan-report";

interface ScanPageProps {
  params: Promise<{ id: string }>;
}

export default async function ScanPage({
  params,
}: ScanPageProps): Promise<React.JSX.Element> {
  const { id } = await params;
  return <ScanReportView scanId={id} />;
}
