import { getHeelSeat } from "~/lib/heel/last-seat-adapter";
import { createHeelParameters } from "~/lib/heel/model";
import { HeelEditor } from "./HeelEditor";

export default async function HeelPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const example =
    (await searchParams).example === "broad" ? "broad" : "slender";
  const seat = getHeelSeat(80, 2);
  return (
    <HeelEditor
      initialSeat={seat}
      initialParameters={createHeelParameters(seat, example)}
      example={example}
    />
  );
}
