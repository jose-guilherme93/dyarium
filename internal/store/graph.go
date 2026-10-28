package store

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"
)

// Graph node kinds. Notes only appear in the focus (expanded) graph; the
// default graph is the ego network of people, places and themes.
const (
	GraphUser   = "user"
	GraphNote   = "note"
	GraphPerson = EntityPerson
	GraphPlace  = EntityPlace
	GraphTheme  = EntityTheme
)

// Graph node/edge ids are stable and prefixed by kind, so the client can tell a
// person from a place with the same database id.
func GraphNodeID(kind, id string) string { return kind + ":" + id }

// GraphNode is one circle in the map.
type GraphNode struct {
	ID    string
	Kind  string
	Label string
	// Icon is a custom monochrome glyph key; empty falls back to the kind icon.
	Icon      string
	Mentions  int
	Notes     int
	Sentiment float64
	LastSeen  time.Time
	// Note nodes only.
	Date   time.Time
	Author string
}

// GraphEdge is one line. Relation edges leave the user; cooccurrence edges
// connect two entities that share a note; mention edges connect a note to an
// entity in the expanded graph.
type GraphEdge struct {
	Source string
	Target string
	Kind   string
	Weight int
}

// GraphData is the map payload without the center label, which belongs to the
// settings layer.
type GraphData struct {
	Nodes      []GraphNode
	Edges      []GraphEdge
	TotalNodes int
	TotalEdges int
	Truncated  bool
}

// GraphOptions narrows and expands the map.
type GraphOptions struct {
	NotebookID string
	From       time.Time
	To         time.Time
	// Focus is a node id ("person:<entity id>", "place:<id>", "theme:<id>").
	// Empty returns the ego network; set returns that entity, its notes and the
	// entities those notes mention.
	Focus string

	NodeLimit    int
	EdgeLimit    int
	NoteLimit    int
	EdgesPerNode int
}

func (o *GraphOptions) defaults() {
	if o.NodeLimit <= 0 {
		o.NodeLimit = 250
	}
	if o.EdgeLimit <= 0 {
		o.EdgeLimit = 1500
	}
	if o.NoteLimit <= 0 {
		o.NoteLimit = 100
	}
	if o.EdgesPerNode <= 0 {
		o.EdgesPerNode = 12
	}
}

// entryFilter builds the WHERE fragment shared by every graph query. e is the
// entries alias.
func (o GraphOptions) entryFilter() (string, []any) {
	where := `e.deleted_at IS NULL`
	var args []any
	if notebook := strings.TrimSpace(o.NotebookID); notebook != "" {
		where += ` AND e.notebook_id = ?`
		args = append(args, notebook)
	}
	if !o.From.IsZero() {
		where += ` AND COALESCE(e.recorded_at, e.created_at) >= ?`
		args = append(args, ts(o.From))
	}
	if !o.To.IsZero() {
		where += ` AND COALESCE(e.recorded_at, e.created_at) <= ?`
		args = append(args, ts(o.To))
	}
	return where, args
}

// Graph returns the relationship map. The default graph is the user's ego
// network of entities: direct edges to each entity and entity-to-entity edges
// when they share a note. Focus adds the notes of one entity and the entities
// they mention, which is the local graph the map opens on click.
func (s *Store) Graph(ctx context.Context, opts GraphOptions) (GraphData, error) {
	opts.defaults()
	if strings.TrimSpace(opts.Focus) != "" {
		return s.focusGraph(ctx, opts)
	}
	return s.egoGraph(ctx, opts)
}

func (s *Store) egoGraph(ctx context.Context, opts GraphOptions) (GraphData, error) {
	where, args := opts.entryFilter()
	nodeQuery := `
		SELECT en.id, en.kind, en.name, COALESCE(en.icon, ''),
			COALESCE(SUM(ee.count), 0) AS mentions,
			COUNT(DISTINCT ee.entry_id) AS notes,
			COALESCE(AVG(ee.sentiment), 0) AS sentiment,
			COALESCE(MAX(COALESCE(e.recorded_at, e.created_at)), '') AS last_seen
		FROM entities en
		JOIN entry_entities ee ON ee.entity_id = en.id
		JOIN entries e ON e.id = ee.entry_id
		WHERE ` + where + `
		GROUP BY en.id, en.kind, en.name
		ORDER BY mentions DESC, en.name
		LIMIT ?`
	nodeArgs := append(append([]any{}, args...), opts.NodeLimit+1)
	rows, err := s.db.QueryContext(ctx, nodeQuery, nodeArgs...)
	if err != nil {
		return GraphData{}, fmt.Errorf("store: graph nodes: %w", err)
	}
	data := GraphData{}
	ids := make([]string, 0, opts.NodeLimit)
	kindByID := make(map[string]string, opts.NodeLimit)
	truncated := false
	for rows.Next() {
		node, err := scanGraphNode(rows)
		if err != nil {
			return GraphData{}, err
		}
		if len(data.Nodes) == opts.NodeLimit {
			truncated = true
			break
		}
		rawID := node.ID
		node.ID = GraphNodeID(node.Kind, rawID)
		kindByID[rawID] = node.Kind
		data.Nodes = append(data.Nodes, node)
		ids = append(ids, rawID)
	}
	if err := rows.Err(); err != nil {
		return GraphData{}, rows.Err()
	}
	if err := rows.Close(); err != nil {
		return GraphData{}, err
	}

	// Direct edges from the center. Weight is the number of notes that mention
	// the entity; the node carries the mentions for the radius.
	for _, node := range data.Nodes {
		data.Edges = append(data.Edges, GraphEdge{
			Source: GraphUser, Target: node.ID, Kind: "relation", Weight: node.Notes,
		})
	}

	// Entity-to-entity edges are co-occurrences in the same note. Limit first,
	// then keep at most EdgesPerNode per endpoint to avoid a hairball.
	if len(ids) > 1 {
		co, total, coTruncated, err := s.cooccurrenceEdges(ctx, opts, ids, kindByID)
		if err != nil {
			return GraphData{}, err
		}
		data.Edges = append(data.Edges, co...)
		data.TotalEdges = len(data.Nodes) + total
		truncated = truncated || coTruncated
	}

	// Total nodes is the count of entities in the filtered scope, not just the
	// page the map drew.
	countArgs := append([]any{}, args...)
	if err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM (
			SELECT en.id FROM entities en
			JOIN entry_entities ee ON ee.entity_id = en.id
			JOIN entries e ON e.id = ee.entry_id
			WHERE `+where+`
			GROUP BY en.id
		)`, countArgs...).Scan(&data.TotalNodes); err != nil {
		return GraphData{}, fmt.Errorf("store: count graph nodes: %w", err)
	}
	if data.TotalEdges == 0 {
		data.TotalEdges = len(data.Edges)
	}
	data.Truncated = truncated || data.TotalNodes > len(data.Nodes)
	return data, nil
}

func (s *Store) cooccurrenceEdges(ctx context.Context, opts GraphOptions, ids []string, kindByID map[string]string) ([]GraphEdge, int, bool, error) {
	where, args := opts.entryFilter()
	in := placeholders(len(ids))
	query := `
		SELECT a.entity_id, b.entity_id, COUNT(DISTINCT a.entry_id) AS shared
		FROM entry_entities a
		JOIN entry_entities b ON b.entry_id = a.entry_id
		JOIN entries e ON e.id = a.entry_id
		WHERE a.entity_id IN (` + in + `)
			AND b.entity_id IN (` + in + `)
			AND a.entity_id < b.entity_id
			AND ` + where + `
		GROUP BY a.entity_id, b.entity_id
		ORDER BY shared DESC, a.entity_id, b.entity_id
		LIMIT ?`
	queryArgs := make([]any, 0, len(ids)*2+len(args)+1)
	for _, id := range ids {
		queryArgs = append(queryArgs, id)
	}
	for _, id := range ids {
		queryArgs = append(queryArgs, id)
	}
	queryArgs = append(queryArgs, args...)
	// Read one extra pair so hitting the cap is visible.
	queryArgs = append(queryArgs, 20001)
	rows, err := s.db.QueryContext(ctx, query, queryArgs...)
	if err != nil {
		return nil, 0, false, fmt.Errorf("store: graph cooccurrence: %w", err)
	}
	defer rows.Close()
	type pair struct {
		a, b   string
		shared int
	}
	var pairs []pair
	truncated := false
	for rows.Next() {
		var a, b string
		var shared int
		if err := rows.Scan(&a, &b, &shared); err != nil {
			return nil, 0, false, err
		}
		if len(pairs) == 20000 {
			truncated = true
			break
		}
		pairs = append(pairs, pair{a: a, b: b, shared: shared})
	}
	if err := rows.Err(); err != nil {
		return nil, 0, false, err
	}
	// Keep the strongest pairs, but cap each endpoint. Without this a single
	// hub (work, family) would connect to every theme and hide the rest.
	perNode := make(map[string]int, len(ids))
	edges := make([]GraphEdge, 0, len(pairs))
	for _, p := range pairs {
		if perNode[p.a] >= opts.EdgesPerNode && perNode[p.b] >= opts.EdgesPerNode {
			truncated = true
			continue
		}
		if perNode[p.a] >= opts.EdgesPerNode || perNode[p.b] >= opts.EdgesPerNode {
			truncated = true
			continue
		}
		perNode[p.a]++
		perNode[p.b]++
		edges = append(edges, GraphEdge{
			Source: GraphNodeID(kindByID[p.a], p.a),
			Target: GraphNodeID(kindByID[p.b], p.b),
			Kind:   "cooccurrence",
			Weight: p.shared,
		})
	}
	return edges, len(pairs), truncated, nil
}

func scanGraphNode(scanner interface{ Scan(...any) error }) (GraphNode, error) {
	var node GraphNode
	var lastSeen string
	if err := scanner.Scan(&node.ID, &node.Kind, &node.Label, &node.Icon, &node.Mentions, &node.Notes, &node.Sentiment, &lastSeen); err != nil {
		return GraphNode{}, fmt.Errorf("store: scan graph node: %w", err)
	}
	node.LastSeen = parseTS(lastSeen)
	return node, nil
}

func placeholders(n int) string {
	if n <= 0 {
		return ""
	}
	return strings.TrimSuffix(strings.Repeat("?,", n), ",")
}

// focusGraph opens one entity: its notes, the entities those notes mention and
// the note-to-entity edges. The center connects only to the focused entity;
// notes are evidence, not a second hub.
func (s *Store) focusGraph(ctx context.Context, opts GraphOptions) (GraphData, error) {
	kind, entityID, ok := splitGraphID(opts.Focus)
	if !ok || !ValidEntityKind(kind) {
		return GraphData{}, ErrNotFound
	}
	where, args := opts.entryFilter()

	var focus GraphNode
	var lastSeen string
	focusQuery := `
		SELECT en.id, en.kind, en.name, COALESCE(en.icon, ''),
			COALESCE(SUM(ee.count), 0),
			COUNT(DISTINCT ee.entry_id),
			COALESCE(AVG(ee.sentiment), 0),
			COALESCE(MAX(COALESCE(e.recorded_at, e.created_at)), '')
		FROM entities en
		JOIN entry_entities ee ON ee.entity_id = en.id
		JOIN entries e ON e.id = ee.entry_id
		WHERE en.id = ? AND ` + where + `
		GROUP BY en.id, en.kind, en.name`
	focusArgs := append([]any{entityID}, args...)
	err := s.db.QueryRowContext(ctx, focusQuery, focusArgs...).Scan(
		&focus.ID, &focus.Kind, &focus.Label, &focus.Icon, &focus.Mentions, &focus.Notes, &focus.Sentiment, &lastSeen)
	if err == sql.ErrNoRows {
		return GraphData{}, ErrNotFound
	}
	if err != nil {
		return GraphData{}, fmt.Errorf("store: focus entity: %w", err)
	}
	focus.LastSeen = parseTS(lastSeen)
	focus.ID = GraphNodeID(kind, entityID)

	// Notes of the focus, newest first. The cap is the map's expansion budget.
	noteQuery := `
		SELECT e.id, COALESCE(e.title, ''), COALESCE(e.recorded_at, e.created_at), COALESCE(e.author, '')
		FROM entry_entities ee
		JOIN entries e ON e.id = ee.entry_id
		WHERE ee.entity_id = ? AND ` + where + `
		ORDER BY COALESCE(e.recorded_at, e.created_at) DESC, e.id DESC
		LIMIT ?`
	noteArgs := append([]any{entityID}, args...)
	noteArgs = append(noteArgs, opts.NoteLimit+1)
	rows, err := s.db.QueryContext(ctx, noteQuery, noteArgs...)
	if err != nil {
		return GraphData{}, fmt.Errorf("store: focus notes: %w", err)
	}
	var noteIDs []string
	var noteNodes []GraphNode
	notesTruncated := false
	for rows.Next() {
		var id, title, date, author string
		if err := rows.Scan(&id, &title, &date, &author); err != nil {
			return GraphData{}, fmt.Errorf("store: scan focus note: %w", err)
		}
		if len(noteNodes) == opts.NoteLimit {
			notesTruncated = true
			break
		}
		noteIDs = append(noteIDs, id)
		noteNodes = append(noteNodes, GraphNode{
			ID:     GraphNodeID(GraphNote, id),
			Kind:   GraphNote,
			Label:  title,
			Date:   parseTS(date),
			Author: author,
		})
	}
	if err := rows.Err(); err != nil {
		return GraphData{}, rows.Err()
	}
	if err := rows.Close(); err != nil {
		return GraphData{}, err
	}

	data := GraphData{TotalNodes: 1 + len(noteNodes)}
	if len(noteNodes) == 0 {
		data.Nodes = append(data.Nodes, focus)
		data.Edges = append(data.Edges, GraphEdge{Source: GraphUser, Target: focus.ID, Kind: "relation", Weight: focus.Notes})
		data.TotalEdges = 1
		data.Truncated = notesTruncated
		return data, nil
	}

	// Entities mentioned by those notes, with the aggregate inside this local
	// view so node sizes stay proportional to what is on screen.
	in := placeholders(len(noteIDs))
	entityQuery := `
		SELECT en.id, en.kind, en.name, COALESCE(en.icon, ''),
			COALESCE(SUM(ee.count), 0),
			COUNT(DISTINCT ee.entry_id),
			COALESCE(AVG(ee.sentiment), 0),
			COALESCE(MAX(COALESCE(e.recorded_at, e.created_at)), '')
		FROM entry_entities ee
		JOIN entities en ON en.id = ee.entity_id
		JOIN entries e ON e.id = ee.entry_id
		WHERE ee.entry_id IN (` + in + `) AND en.id <> ? AND ` + where + `
		GROUP BY en.id, en.kind, en.name
		ORDER BY SUM(ee.count) DESC, en.name
		LIMIT ?`
	entityArgs := make([]any, 0, len(noteIDs)+len(args)+2)
	for _, id := range noteIDs {
		entityArgs = append(entityArgs, id)
	}
	entityArgs = append(entityArgs, entityID)
	entityArgs = append(entityArgs, args...)
	entityArgs = append(entityArgs, opts.NodeLimit+1)
	entityRows, err := s.db.QueryContext(ctx, entityQuery, entityArgs...)
	if err != nil {
		return GraphData{}, fmt.Errorf("store: focus entities: %w", err)
	}
	entities := []GraphNode{focus}
	entitiesTruncated := false
	for entityRows.Next() {
		node, err := scanGraphNode(entityRows)
		if err != nil {
			return GraphData{}, err
		}
		if len(entities) > opts.NodeLimit {
			entitiesTruncated = true
			break
		}
		node.ID = GraphNodeID(node.Kind, node.ID)
		entities = append(entities, node)
	}
	if err := entityRows.Err(); err != nil {
		return GraphData{}, entityRows.Err()
	}
	if err := entityRows.Close(); err != nil {
		return GraphData{}, err
	}

	// Notes as evidence, then one edge per note/entity pair. The focus entity is
	// included on purpose: the note belongs to it.
	data.Nodes = append(data.Nodes, entities...)
	data.Nodes = append(data.Nodes, noteNodes...)
	data.Edges = append(data.Edges, GraphEdge{Source: GraphUser, Target: focus.ID, Kind: "relation", Weight: focus.Notes})
	entityIDs := make([]string, 0, len(entities))
	for _, node := range entities {
		entityIDs = append(entityIDs, strings.TrimPrefix(node.ID, node.Kind+":"))
	}
	linkQuery := `
		SELECT ee.entry_id, ee.entity_id, ee.count
		FROM entry_entities ee
		WHERE ee.entry_id IN (` + in + `) AND ee.entity_id IN (` + placeholders(len(entityIDs)) + `)
		ORDER BY ee.count DESC
		LIMIT ?`
	linkArgs := make([]any, 0, len(noteIDs)+len(entityIDs)+1)
	for _, id := range noteIDs {
		linkArgs = append(linkArgs, id)
	}
	for _, id := range entityIDs {
		linkArgs = append(linkArgs, id)
	}
	linkArgs = append(linkArgs, opts.EdgeLimit+1)
	linkRows, err := s.db.QueryContext(ctx, linkQuery, linkArgs...)
	if err != nil {
		return GraphData{}, fmt.Errorf("store: focus links: %w", err)
	}
	defer linkRows.Close()
	kindByID := make(map[string]string, len(entities))
	for _, node := range entities {
		kindByID[strings.TrimPrefix(node.ID, node.Kind+":")] = node.Kind
	}
	linksTruncated := false
	for linkRows.Next() {
		var entryID, entityID string
		var count int
		if err := linkRows.Scan(&entryID, &entityID, &count); err != nil {
			return GraphData{}, fmt.Errorf("store: scan focus link: %w", err)
		}
		if len(data.Edges) >= opts.EdgeLimit {
			linksTruncated = true
			break
		}
		entityNode := GraphNodeID(kindByID[entityID], entityID)
		data.Edges = append(data.Edges, GraphEdge{
			Source: GraphNodeID(GraphNote, entryID), Target: entityNode, Kind: "mention", Weight: count,
		})
	}
	if err := linkRows.Err(); err != nil {
		return GraphData{}, linkRows.Err()
	}

	data.TotalNodes = len(entities) + len(noteNodes)
	data.TotalEdges = len(data.Edges)
	data.Truncated = notesTruncated || entitiesTruncated || linksTruncated
	return data, nil
}

func splitGraphID(id string) (string, string, bool) {
	kind, rest, ok := strings.Cut(id, ":")
	if !ok || kind == "" || rest == "" {
		return "", "", false
	}
	return kind, rest, true
}
