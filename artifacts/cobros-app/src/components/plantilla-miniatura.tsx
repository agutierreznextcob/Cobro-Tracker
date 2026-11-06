import type { EmpresaPlantilla } from "@workspace/api-client-react";

type Props = {
  plantilla: EmpresaPlantilla;
  color: string;
  logoUrl?: string | null;
  nombre?: string;
  className?: string;
};

/** Schematic A4 thumbnail of each PDF template (not a real document). */
export function PlantillaMiniatura({ plantilla, color, logoUrl, nombre, className = "" }: Props) {
  const bar = (w: string, c = "bg-slate-300", h = "h-[3px]") => <div className={`${h} ${c} rounded-full`} style={{ width: w }} />;
  const rows = (n: number, zebra: boolean, shade?: string) => (
    <div>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className={`flex items-center gap-[4%] px-[3%] py-[2.2%] ${zebra && i % 2 ? "bg-slate-100" : ""} ${!zebra ? "border-b border-slate-200" : ""}`}>
          <div className="w-[6%]">{bar("100%", "bg-slate-300")}</div>
          <div className="flex-1 py-[1%] -my-[1%]" style={shade ? { background: shade } : undefined}>{bar(`${60 + ((i * 17) % 35)}%`)}</div>
          <div className="w-[14%]">{bar("100%")}</div>
          <div className="w-[16%]">{bar("100%", "bg-slate-400")}</div>
        </div>
      ))}
    </div>
  );
  const logo = (onColor: boolean) =>
    logoUrl ? (
      <img src={logoUrl} alt="" className={`max-h-full max-w-full object-contain ${onColor ? "brightness-0 invert" : ""}`} />
    ) : (
      <div className={`h-full aspect-square rounded-full ${onColor ? "bg-white/85" : "bg-slate-300"}`} />
    );
  const name = (nombre || "Tu empresa").slice(0, 28);

  return (
    <div className={`aspect-[210/297] w-full bg-white rounded-[3px] shadow-[0_1px_2px_rgba(15,23,42,.08),0_8px_24px_-12px_rgba(15,23,42,.25)] overflow-hidden text-slate-800 select-none ${className}`} aria-hidden>
      {plantilla === "clasica" && (
        <div className="p-[7%] space-y-[5%] h-full flex flex-col">
          <div className="flex justify-between items-start h-[9%]">
            <div className="h-full w-[30%] flex items-start">{logo(false)}</div>
            <div className="flex flex-col items-end gap-[3px] w-[45%]">
              <p className="text-[6px] font-bold leading-none truncate max-w-full">{name}</p>
              {bar("80%")}{bar("60%")}{bar("70%")}
            </div>
          </div>
          <div className="bg-slate-100 py-[2.5%] text-center text-[6px] font-bold tracking-[0.2em]">COTIZACIÓN</div>
          <div className="flex gap-[3%]">{[0, 1, 2].map((i) => <div key={i} className="flex-1 border border-slate-300 p-[3%] space-y-[3px]">{bar("50%")}{bar("80%", "bg-slate-500", "h-[4px]")}</div>)}</div>
          <div className="bg-slate-50 border-l-[3px] border-slate-700 p-[3%] space-y-[3px]">{bar("55%", "bg-slate-500")}{bar("40%")}{bar("45%")}</div>
          <div>
            <div className="bg-slate-800 h-[9px]" />
            {rows(6, true)}
          </div>
          <div className="ml-auto w-[42%] space-y-[3px]">{bar("100%")}{bar("100%")}<div className="border-t border-slate-700 pt-[3px]">{bar("100%", "bg-slate-800", "h-[5px]")}</div></div>
          <div className="mt-auto border-t border-slate-300 pt-[2%] flex justify-center">{bar("70%")}</div>
        </div>
      )}
      {plantilla === "moderna" && (
        <div className="h-full flex flex-col">
          <div className="px-[7%] py-[5%] flex items-center justify-between" style={{ background: color }}>
            <div className="flex items-center gap-[5%] h-[18px] w-[60%]">
              <div className="h-full shrink-0">{logo(true)}</div>
              <p className="text-[6px] font-bold text-white leading-tight truncate">{name}</p>
            </div>
            <div className="text-right"><p className="text-[3.5px] tracking-[0.2em] text-white/80">COTIZACIÓN</p><p className="text-[9px] font-bold text-white leading-none">COT-0001</p></div>
          </div>
          <div className="px-[7%] pt-[6%] space-y-[6%] flex-1 flex flex-col">
            <div className="flex">
              <div className="flex-1 pr-[4%] space-y-[3px] border-r border-slate-200">{bar("20%", undefined, "h-[2px]")}{bar("60%", "bg-slate-500")}{bar("75%")}{bar("50%")}</div>
              <div className="flex-1 pl-[4%] space-y-[3px]">{bar("20%", undefined, "h-[2px]")}{bar("60%", "bg-slate-500")}{bar("45%")}{bar("55%")}</div>
            </div>
            <div><div className="border-b border-slate-800 pb-[2%] flex gap-[4%]">{bar("8%", "bg-slate-400", "h-[2px]")}{bar("22%", "bg-slate-400", "h-[2px]")}</div>{rows(7, false)}</div>
            <div className="ml-auto w-[44%] p-[4%] space-y-[3px] rounded-[1px]" style={{ background: color }}>{bar("100%", "bg-white/50")}{bar("100%", "bg-white/50")}{bar("100%", "bg-white", "h-[5px]")}</div>
            <div className="mt-auto pb-[6%] flex justify-center">{bar("40%")}</div>
          </div>
        </div>
      )}
      {plantilla === "bicolor" && (
        <div className="h-full flex flex-col">
          <div className="flex h-[17%]">
            <div className="w-1/2 p-[6%] flex flex-col justify-between" style={{ background: color }}>
              <div className="h-[55%]">{logo(true)}</div>
              <p className="text-[4.5px] tracking-[0.25em] font-bold text-white">COTIZACIÓN</p>
            </div>
            <div className="w-1/2 p-[6%] space-y-[3px]"><p className="text-[5.5px] font-bold truncate">{name}</p>{bar("80%")}{bar("65%")}{bar("70%")}</div>
          </div>
          <div className="px-[7%] pt-[5%] space-y-[5%] flex-1 flex flex-col">
            <div className="flex items-center justify-between"><p className="text-[8px] font-bold leading-none" style={{ color }}>N° COT-0001</p><span className="text-[3.5px] font-bold px-[5px] py-[2px] rounded-full tracking-wider" style={{ color, background: `${color}26` }}>ENVIADA</span></div>
            <div className="border border-slate-200"><div className="h-[6px]" style={{ background: `${color}1a` }} /><div className="grid grid-cols-2 gap-[3px] p-[3%]">{bar("70%", "bg-slate-500")}{bar("50%")}{bar("40%")}{bar("60%")}</div></div>
            <div><div className="h-[9px]" style={{ background: color }} />{rows(6, false, `${color}14`)}</div>
            <div className="ml-auto w-[42%] space-y-[3px]">{bar("100%")}{bar("100%")}<div className="pt-[3px] border-t-2" style={{ borderColor: color }}><div className="h-[5px] rounded-full" style={{ background: color }} /></div></div>
            <div className="bg-slate-100 p-[3%] space-y-[3px]">{bar("90%")}{bar("70%")}</div>
          </div>
          <div className="h-[3.5%] mt-[3%]" style={{ background: color }} />
        </div>
      )}
    </div>
  );
}
