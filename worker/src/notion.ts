import { Client } from '@notionhq/client';

export type WorkoutNodeType = 'exercise' | 'rest' | 'circuit' | 'superset' | 'amrap' | 'emom' | 'conditional';

export type WorkoutNode = {
  block_id: string;
  type: WorkoutNodeType;
  label: string;
  duration_ms?: number;
  reps?: number;
  dsl_ast?: any;
  children?: WorkoutNode[];
}

export class NotionService {
  private client: Client;

  constructor(auth: string) {
    this.client = new Client({ auth });
  }

  // Parses a simple DSL string into an initial AST.
  // We mock the complex parser tree for demonstration in Phase 2 Workstream 1.
  private parseDSL(dslText: string): any {
    if (!dslText || dslText.trim() === '') return null;
    
    // Minimal mock regex parser for: if $env.readiness < 5 { skip }
    if (dslText.includes('if $env.readiness')) {
      return {
        type: "IfStatement",
        condition: {
          type: "ExecutionCondition",
          left: "$env.readiness", 
          operator: dslText.includes('<') ? '<' : '>',
          right: 5 // mock
        },
        consequent: [{ action: "skip" }],
      };
    }
    return { type: 'RawDSL', raw: dslText };
  }

  // Retrieve the main Workout page metadata
  async getWorkout(workoutId: string): Promise<any> {
    return await this.client.pages.retrieve({ page_id: workoutId });
  }

  // Retrieve an individual block and format it to our Engine AST structure
  async getWorkoutBlock(blockId: string): Promise<WorkoutNode> {
    const block = await this.client.pages.retrieve({ page_id: blockId }) as any;
    const props = block.properties;

    const label = props.Name?.title?.[0]?.plain_text || 'Unknown';
    const type = (props['Block Type']?.select?.name?.toLowerCase() || 'exercise') as WorkoutNodeType;
    const durationSeconds = props['Default Duration']?.number || 0;
    const reps = props['Default Reps']?.number || 0;
    const dslText = props['DSL Rules']?.rich_text?.[0]?.plain_text || '';

    const node: WorkoutNode = {
      block_id: block.id,
      type,
      label,
    };

    if (durationSeconds) node.duration_ms = durationSeconds * 1000;
    if (reps) node.reps = reps;
    if (dslText) node.dsl_ast = this.parseDSL(dslText);

    return node;
  }

  // Fetch a node and recursively fetch all its children
  private async fetchNodeAndChildren(blockId: string, blocksDatabaseId: string): Promise<WorkoutNode> {
    const node = await this.getWorkoutBlock(blockId);
    
    // Find children where 'Parent Block' relates to this blockId
    const childrenQuery = await (this.client.databases as any).query({
      database_id: blocksDatabaseId,
      filter: {
        property: 'Parent Block',
        relation: {
          contains: blockId
        }
      },
      sorts: [
        {
          property: 'Order Index',
          direction: 'ascending'
        }
      ]
    });

    if (childrenQuery.results.length > 0) {
      node.children = [];
      for (const child of childrenQuery.results) {
         const childNode = await this.fetchNodeAndChildren(child.id, blocksDatabaseId);
         node.children.push(childNode);
      }
    }

    return node;
  }

  // Entry point to build the entire workout AST for the App
  async buildWorkoutAST(workoutId: string, blocksDatabaseId: string): Promise<any> {
    const workout = await this.getWorkout(workoutId) as any;
    
    // Get top-level references
    const topLevelBlocksRelation = workout.properties['Top-Level Blocks']?.relation || [];
    
    const rootBlocks: WorkoutNode[] = [];
    for (const rel of topLevelBlocksRelation) {
         const node = await this.fetchNodeAndChildren(rel.id, blocksDatabaseId);
         rootBlocks.push(node);
    }

    return {
      workout_id: workoutId,
      name: workout.properties?.Name?.title?.[0]?.plain_text || "Unknown Workout",
      blocks: rootBlocks,
      loaded_at: new Date().toISOString()
    };
  }

  // Check if the workout has been edited after a given timestamp (Workstream 4)
  async checkDirtyState(workoutId: string, sinceIsoString: string): Promise<boolean> {
    const workout = await this.client.pages.retrieve({ page_id: workoutId }) as any;
    const sinceDate = new Date(sinceIsoString).getTime();
    const lastEditedDate = new Date(workout.last_edited_time).getTime();

    // Return true if the Notion page's last edit time is newer than our client checkout time
    return lastEditedDate > sinceDate;
  }
}
