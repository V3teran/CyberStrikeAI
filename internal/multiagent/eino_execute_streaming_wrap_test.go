package multiagent

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"
	"time"

	"cyberstrike-ai/internal/einomcp"

	"github.com/cloudwego/eino/adk/filesystem"
	"github.com/cloudwego/eino/schema"
)

type mockStreamingShell struct {
	immediateErr error
	recvErr      error
	output       string
}

func (m *mockStreamingShell) ExecuteStreaming(ctx context.Context, input *filesystem.ExecuteRequest) (*schema.StreamReader[*filesystem.ExecuteResponse], error) {
	if m.immediateErr != nil {
		return nil, m.immediateErr
	}
	outR, outW := schema.Pipe[*filesystem.ExecuteResponse](4)
	go func() {
		defer outW.Close()
		if strings.TrimSpace(m.output) != "" {
			_ = outW.Send(&filesystem.ExecuteResponse{Output: m.output}, nil)
		}
		if m.recvErr != nil {
			_ = outW.Send(nil, m.recvErr)
		}
	}()
	return outR, nil
}

func TestEinoExecuteRecvErrIsToolTimeout(t *testing.T) {
	tctx, cancel := context.WithTimeout(context.Background(), time.Millisecond)
	defer cancel()
	time.Sleep(2 * time.Millisecond)
	<-tctx.Done()

	if !einoExecuteRecvErrIsToolTimeout(context.Canceled, tctx) {
		t.Fatal("expected canceled recv with deadline exec ctx to count as tool timeout")
	}
	if !einoExecuteRecvErrIsToolTimeout(context.DeadlineExceeded, nil) {
		t.Fatal("expected DeadlineExceeded recv without tctx")
	}
	if einoExecuteRecvErrIsToolTimeout(errors.New("exit status 1"), context.Background()) {
		t.Fatal("unexpected timeout for generic error")
	}
}

func TestEinoStreamingShellWrap_ToolTimeoutImmediateErrIsSoft(t *testing.T) {
	inner := &mockStreamingShell{immediateErr: context.DeadlineExceeded}
	wrap := &einoStreamingShellWrap{
		inner:              inner,
		toolTimeoutMinutes: 60,
	}
	sr, err := wrap.ExecuteStreaming(context.Background(), &filesystem.ExecuteRequest{Command: "true"})
	if err != nil {
		t.Fatalf("immediate tool timeout must return soft stream, got err: %v", err)
	}
	defer sr.Close()

	var got strings.Builder
	for {
		resp, rerr := sr.Recv()
		if errors.Is(rerr, io.EOF) {
			break
		}
		if rerr != nil {
			t.Fatalf("outer stream must not hard-fail, got: %v", rerr)
		}
		if resp != nil && resp.Output != "" {
			got.WriteString(resp.Output)
		}
	}
	if !strings.Contains(got.String(), einoExecuteTimeoutUserHint()) {
		t.Fatalf("expected timeout hint, got: %q", got.String())
	}
}

func TestEinoStreamingShellWrap_ToolTimeoutRecvErrIsSoft(t *testing.T) {
	inner := &mockStreamingShell{recvErr: context.DeadlineExceeded}
	notify := einomcp.NewToolInvokeNotifyHolder()
	wrap := &einoStreamingShellWrap{
		inner:              inner,
		invokeNotify:       notify,
		toolTimeoutMinutes: 60,
	}
	// 生产路径由 Eino compose 注入 toolCallID；单测通过已过期 execCtx 识别 tool_timeout 软错误。
	tctx, cancel := context.WithTimeout(context.Background(), time.Millisecond)
	defer cancel()
	time.Sleep(2 * time.Millisecond)
	<-tctx.Done()

	sr, err := wrap.ExecuteStreaming(tctx, &filesystem.ExecuteRequest{Command: "sleep 999"})
	if err != nil {
		t.Fatalf("ExecuteStreaming: %v", err)
	}
	defer sr.Close()

	var got strings.Builder
	for {
		resp, rerr := sr.Recv()
		if errors.Is(rerr, io.EOF) {
			break
		}
		if rerr != nil {
			t.Fatalf("outer stream must not hard-fail on tool timeout, got: %v", rerr)
		}
		if resp != nil && resp.Output != "" {
			got.WriteString(resp.Output)
		}
	}
	if !strings.Contains(got.String(), einoExecuteTimeoutUserHint()) {
		t.Fatalf("expected timeout hint in stream, got: %q", got.String())
	}
}

func TestEinoStreamingShellWrap_NonTimeoutRecvErrStillHard(t *testing.T) {
	inner := &mockStreamingShell{recvErr: errors.New("broken pipe")}
	wrap := &einoStreamingShellWrap{inner: inner}
	sr, err := wrap.ExecuteStreaming(context.Background(), &filesystem.ExecuteRequest{Command: "true"})
	if err != nil {
		t.Fatalf("ExecuteStreaming: %v", err)
	}
	defer sr.Close()

	_, rerr := sr.Recv()
	if rerr == nil || errors.Is(rerr, io.EOF) {
		t.Fatal("expected hard stream error for non-timeout failure")
	}
}
