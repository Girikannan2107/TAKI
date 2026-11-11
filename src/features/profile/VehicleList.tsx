"use client";

import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Truck } from "lucide-react";
import { Button, Card, FormField, Input, useToast } from "@/components/ui";
import type { Id, Vehicle } from "@/lib/domain/types";
import { vehicleModelLabel } from "@/lib/domain/vehicles";
import { formatKg } from "@/lib/format";
import {
  normalizeRegistration,
  vehicleRegistrationSchema,
  type VehicleRegistrationValues,
} from "@/lib/schemas/profile.schema";
import { errorMessage, marketplace } from "@/lib/services/marketplace";
import { useTakiStore } from "@/lib/store";

/** Driver profile "Vehicle details": each vehicle's model, capacity and editable registration number. */
export function VehicleList({ driverId }: { driverId: Id }) {
  const allVehicles = useTakiStore((s) => s.db.vehicles);
  const vehicles = useMemo(
    () => Object.values(allVehicles).filter((v) => v.driverId === driverId),
    [allVehicles, driverId],
  );

  return (
    <Card as="section" aria-labelledby="vehicles-heading">
      <h2 id="vehicles-heading" className="type-h3 mb-1 text-ink">
        Vehicle details
      </h2>
      {vehicles.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No vehicles yet. A vehicle is added to your profile when you publish your first route.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-4">
          {vehicles.map((v) => (
            <VehicleRow key={`${v.id}:${v.registrationNumber}`} vehicle={v} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function VehicleRow({ vehicle }: { vehicle: Vehicle }) {
  const { toast } = useToast();
  const fieldId = `reg-${vehicle.id}`;
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<VehicleRegistrationValues>({
    resolver: zodResolver(vehicleRegistrationSchema),
    defaultValues: { registrationNumber: vehicle.registrationNumber },
  });

  async function onSubmit({ registrationNumber }: VehicleRegistrationValues) {
    const normalized = normalizeRegistration(registrationNumber);
    try {
      await marketplace.updateVehicleRegistration(vehicle.id, normalized);
      setValue("registrationNumber", normalized);
      toast({ tone: "success", title: "Registration updated", description: normalized });
    } catch (e) {
      toast({ tone: "error", title: "Couldn't update the vehicle", description: errorMessage(e) });
    }
  }

  return (
    <li className="rounded-md border border-border p-4">
      <div className="mb-3 flex items-start gap-3">
        <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-mint-100 text-green-700">
          <Truck strokeWidth={1.75} className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="font-semibold text-ink">{vehicleModelLabel(vehicle.modelId)}</p>
          <p className="text-sm text-ink-muted">Total capacity {formatKg(vehicle.capacity.maxPayloadKg)}</p>
        </div>
      </div>
      <form noValidate onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <FormField
          label="Registration number"
          htmlFor={fieldId}
          error={errors.registrationNumber?.message}
          hint="e.g. TN 37 XX 4587"
          required
          className="sm:flex-1"
        >
          <Input autoComplete="off" autoCapitalize="characters" spellCheck={false} {...register("registrationNumber")} />
        </FormField>
        <Button
          type="submit"
          variant="outline"
          loading={isSubmitting}
          disabled={!isDirty || isSubmitting}
          className="sm:mt-[30px]"
          aria-label={`Save registration for ${vehicleModelLabel(vehicle.modelId)}`}
        >
          {isSubmitting ? "Saving…" : "Save"}
        </Button>
      </form>
    </li>
  );
}
