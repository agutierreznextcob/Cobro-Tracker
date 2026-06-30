import { Landmark } from "lucide-react";
import { LiquidacionesList } from "@/components/liquidaciones-list";

export default function LiquidacionesPage() {
  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Landmark className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">Liquidaciones Flow</h1>
      </div>
      <LiquidacionesList />
    </div>
  );
}
