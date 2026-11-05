import { capabilities } from '@/src/core/config';
import { connection } from 'next/server';

export async function GET() {
  await connection();
  return Response.json(capabilities(), { headers: { 'Cache-Control': 'no-store' } });
}
