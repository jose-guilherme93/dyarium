import { BrowserProcessing } from "../components/BrowserProcessing";

export function LabView({ onBack }: { onBack?: () => void } = {}) {
  return <BrowserProcessing onBack={onBack} />;
}

export default LabView;
