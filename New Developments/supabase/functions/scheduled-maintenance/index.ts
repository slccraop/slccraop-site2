import { handleMaintenance } from '../_shared/handlers/maintenance.ts';
import { serve } from '../_shared/runtime.ts';

serve(handleMaintenance);
