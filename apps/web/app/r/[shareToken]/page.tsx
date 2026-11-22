import { ScanReportView } from "@/components/scans/scan-report";

interface SharedReportPageProps {
  params: Promise<{ shareToken: string }>;
}

export default async function SharedReportPage({
  params,
}: SharedReportPageProps): Promise<React.JSX.Element> {
  const { shareToken } = await params;
  return <ScanReportView shareToken={shareToken} publicView />;
}
