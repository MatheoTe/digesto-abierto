import { Badge } from "@/components/ui/badge";

interface Status {
  inForce: boolean;
  textSource: "actualizado" | "original" | null;
  laterAmendments: number[];
  sanctionedOn: string | null;
  kind?: string;
}

/** Vigente / no vigente, which official text it is, and whether newer amendments are missing from it. */
export function StatusBadges({ source, showYear = true }: { source: Status; showYear?: boolean }) {
  const year = source.sanctionedOn?.slice(0, 4);
  return (
    <span className="flex flex-wrap gap-1">
      {source.inForce ? <Badge variant="success">Vigente</Badge> : <Badge variant="destructive">No vigente</Badge>}
      {source.kind === "record" ? (
        <Badge variant="outline">Ficha</Badge>
      ) : source.textSource === "actualizado" ? (
        <Badge variant="outline" title="Texto consolidado por la Biblioteca del Concejo con las modificaciones">
          Texto actualizado
        </Badge>
      ) : source.textSource === "original" ? (
        <Badge variant="outline" title="Texto tal como se sancionó">
          Texto original
        </Badge>
      ) : null}
      {source.laterAmendments.length > 0 && (
        <Badge variant="warning" title={`Modificada después por: ${source.laterAmendments.join(", ")}`}>
          Cambios sin incorporar
        </Badge>
      )}
      {showYear && year && <Badge variant="outline">{year}</Badge>}
    </span>
  );
}
