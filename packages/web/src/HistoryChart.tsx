import { createEffect, onCleanup, onMount } from "solid-js";
import { scaleLinear, scaleUtc } from "d3-scale";
import {
    barY,
    defineChart,
    mountChart,
    type ChartHost,
} from "@tanstack/charts";
import { tooltip } from "@tanstack/charts/tooltip";
import type { UsageHistoryPoint } from "./lib/types";

type ChartRow = {
    id: string;
    sampledAt: Date;
    deltaPercent: number;
};

function chartRows(points: UsageHistoryPoint[]): ChartRow[] {
    return points.map((point) => ({
        id: String(point.sampledAtMs),
        sampledAt: new Date(point.sampledAtMs),
        deltaPercent: point.deltaPercent,
    }));
}

function chartDefinition(rows: ChartRow[]) {
    return defineChart({
        marks: [
            barY(rows, {
                id: "usage-delta",
                x: "sampledAt",
                y: "deltaPercent",
                key: "id",
                fill: "#22c55e",
                fillOpacity: 0.85,
                inset: 1,
                radius: 2,
            }),
        ],
        x: {
            scale: scaleUtc,
            nice: true,
            axis: { label: "sample time" },
        },
        y: {
            scale: scaleLinear,
            nice: true,
            grid: true,
            axis: { label: "usage added (%)" },
        },
        tooltip,
    });
}

export function HistoryChart(props: {
    points: UsageHistoryPoint[];
    intervalMinutes: number;
}) {
    let container: HTMLDivElement | undefined;
    let host: ChartHost<ChartRow, Date, number> | undefined;

    const options = () => {
        const rows = chartRows(props.points);
        if (rows.length === 0) return null;
        return {
            definition: chartDefinition(rows),
            height: 320,
            initialWidth: 720,
            ariaLabel: `Provider usage added at each ${props.intervalMinutes}-minute sample`,
            ariaDescription:
                "The bars show the percentage points added between consecutive provider samples.",
        };
    };

    onMount(() => {
        const current = options();
        if (container && current) {
            host = mountChart(container, current);
        }
    });

    createEffect(() => {
        const current = options();
        if (host && current) {
            host.update(current);
        }
    });

    onCleanup(() => host?.destroy());

    return <div ref={container} class="history-chart" />;
}
