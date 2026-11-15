import { Spinner } from "@/components/ui/Spinner";

export default function Loading() {
  return (
    <div className="flex min-h-[60dvh] items-center justify-center text-green-700">
      <Spinner size="lg" label="Loading page" />
    </div>
  );
}
